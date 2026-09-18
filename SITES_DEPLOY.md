# Sites deployment boundary

1. Keep `.env` local and ignored.
2. Configure `VITE_VWORLD_API_KEY` as a hosted build secret.
3. Configure `VITE_VWORLD_DOMAIN` as the exact final public Sites host, then add that origin to the VWorld service-domain allowlist.
4. Build the static Vite app and publish the exact commit.
5. Open the public origin and check: app loads, snapshots load, map fallback works, A/B selection works, financial inputs react, and mobile has no page-level horizontal overflow.
6. If the key is configured, confirm the app's provider pill changes only after the browser-side VWorld probe succeeds. Otherwise keep `Demo geometry` visible.

The browser-side provider key is allowed only because VWorld's WebGL adapter requires it. Domain restriction is mandatory. No Naver, data.go.kr, bank, or vision secret belongs in the browser bundle.
