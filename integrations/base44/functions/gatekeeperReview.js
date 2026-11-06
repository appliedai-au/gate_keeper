import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";
import { createReviewBridge } from "../shared/review-backend.js";

Deno.serve(createReviewBridge({
  authenticate: request => createClientFromRequest(request).auth.me(),
  readEnv: name => Deno.env.get(name),
}));
