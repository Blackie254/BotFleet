type HerokuApp = {
  id: string;
  name: string;
  web_url?: string | null;
};

type HerokuBuild = {
  id: string;
  status: string;
};

function getApiKey(): string {
  const key = process.env.HEROKU_API_KEY;
  if (!key) {
    throw new Error("Heroku deployment is not configured.");
  }
  return key;
}

async function herokuRequest<T>(
  path: string,
  options: { method: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown },
): Promise<T> {
  const response = await fetch(`https://api.heroku.com${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      Accept: "application/vnd.heroku+json; version=3",
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Do not return or log provider response bodies: config-var failures can echo secrets.
    await response.body?.cancel();
    throw new Error(`Heroku request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function createHerokuDeployment(input: {
  appName: string;
  repositoryUrl: string;
  sessionId: string;
  botTemplateId: string;
}) {
  const repoMatch = input.repositoryUrl.match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/,
  );
  if (!repoMatch) {
    throw new Error("Use a public GitHub repository URL for this bot template.");
  }
  const [, owner, repo] = repoMatch;
  const metadataResponse = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!metadataResponse.ok) {
    await metadataResponse.body?.cancel();
    throw new Error("The bot repository must be public and accessible on GitHub.");
  }
  const metadata = (await metadataResponse.json()) as {
    default_branch?: string;
    private?: boolean;
  };
  if (metadata.private || !metadata.default_branch) {
    throw new Error("The bot repository must be public and have a default branch.");
  }

  const app = await herokuRequest<HerokuApp>("/apps", {
    method: "POST",
    body: { name: input.appName, region: "eu" },
  });

  try {
    await herokuRequest<Record<string, string>>(`/apps/${app.id}/config-vars`, {
      method: "PATCH",
      body: {
        BOT_TEMPLATE_ID: input.botTemplateId,
        WHATSAPP_SESSION_ID: input.sessionId,
        NODE_ENV: "production",
      },
    });
    const sourceUrl = `https://github.com/${owner}/${repo}/tarball/${encodeURIComponent(metadata.default_branch)}/`;
    const build = await herokuRequest<HerokuBuild>(`/apps/${app.id}/builds`, {
      method: "POST",
      body: { source_blob: { url: sourceUrl } },
    });
    return { app, build };
  } catch (error) {
    // Keep the app only when the build request was accepted. Failed setup
    // before that point is cleaned up to avoid orphaned paid resources.
    await herokuRequest(`/apps/${app.id}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

export async function getHerokuBuild(appId: string, buildId: string) {
  return herokuRequest<HerokuBuild>(`/apps/${appId}/builds/${buildId}`, {
    method: "GET",
  });
}

export async function setHerokuWorkerCount(appId: string, quantity: number) {
  return herokuRequest(`/apps/${appId}/formation`, {
    method: "PATCH",
    body: { updates: [{ type: "worker", quantity, size: "eco" }] },
  });
}

export async function stopHerokuApp(appId: string) {
  return setHerokuWorkerCount(appId, 0);
}

export async function startHerokuApp(appId: string) {
  return setHerokuWorkerCount(appId, 1);
}
