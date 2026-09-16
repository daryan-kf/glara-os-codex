import { webhook, unsubscribe } from "./communicationHttp";
import { httpRouter } from "convex/server";
import { auth } from "./auth";
const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: "/m9/webhook", method: "POST", handler: webhook });
http.route({ path: "/m9/unsubscribe", method: "GET", handler: unsubscribe });
http.route({ path: "/m9/unsubscribe", method: "POST", handler: unsubscribe });
export default http;
