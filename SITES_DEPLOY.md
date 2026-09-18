# Sites deployment boundary

1. Keep `.env` local and out of Git.
2. Add `VITE_VWORLD_API_KEY` as a secret and `VITE_VWORLD_DOMAIN` as the exact Sites host to the hosted build environment. Do not paste the key into source, documentation, screenshots, or issue comments.
3. Deploy the Vite application as a static site.
4. Copy the final public Site origin.
5. Add that origin to the VWorld API key service-domain allowlist.
6. Open the deployed site and confirm the status pill reaches `VWorld 3D live`. Without the key or with a restricted origin, the app remains usable in `Demo geometry` mode.
7. In a Site-Tools-capable ChatGPT surface, confirm the six SpaceLab WebMCP tools are discoverable.

The browser receives the VWorld key because the VWorld WebGL SDK is a browser-side adapter. Domain restriction is therefore mandatory. The shadow overlay uses site geolocation, local date/time, solar position, and mass height/footprint; it remains an early-stage geometric preview rather than a statutory sunlight-right determination.
