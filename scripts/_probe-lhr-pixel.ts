// Read-only probe: does the /LHR CAPI guard agree with the browser pixel?
import { PIXEL_ID } from "../src/config/lhr-funnel";

const server = (process.env.META_PIXEL_ID || "").trim();
console.log("browser tag PIXEL_ID :", PIXEL_ID);
console.log("server META_PIXEL_ID :", server || "(unset)");
console.log(
  "CAPI Lead would       :",
  !server ? "SKIP (no server pixel configured)"
  : server === PIXEL_ID ? "SEND (pixels agree, dedup works)"
  : "SKIP (pixels differ, would file against the wrong dataset)"
);
