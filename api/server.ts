// Vercel Function: REST API. vercel.json rewrites /api/v1/:path* here.
import { createApiFunctionServer } from "@relay/server";

export default createApiFunctionServer();
