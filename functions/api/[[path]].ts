import { handleRequest, type Env } from "../../src/worker/index";

export const onRequest: PagesFunction<Env> = (context) => {
  return handleRequest(context.request, context.env);
};
