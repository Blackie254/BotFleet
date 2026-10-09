import { Router, type IRouter } from "express";
import healthRouter from "./health";
import hostingRouter from "./hosting";

const router: IRouter = Router();

router.use(healthRouter);
router.use(hostingRouter);

export default router;
