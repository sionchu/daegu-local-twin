# Sites deployment boundary

1. Keep `.env` local and out of Git.
2. Add `VITE_VWORLD_API_KEY` to the hosted build environment. Do not paste it into source, documentation, screenshots, or issue comments.
3. Deploy the Vite application as a static site.
4. Copy the final public Site origin.
5. Add that origin to the VWorld API key service-domain allowlist.
6. Open the deployed site and confirm the status pill reaches `VWorld 3D live`. Without the key or with a restricted origin, the app remains usable in `Demo geometry` mode.
7. In a Site-Tools-capable ChatGPT surface, confirm the six SpaceLab WebMCP tools are discoverable.

The browser receives the VWorld key because the VWorld WebGL SDK is a browser-side adapter. Domain restriction is therefore mandatory. This V0 exposes qualitative shadow preview only; deployment does not change that product boundary.
