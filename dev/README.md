# containerlab-gui Dev App

Standalone Vite app for TopoViewer and related webviews.

## Run

```bash
npm run dev
```

Opens `http://localhost:5173`.

## Runtime model

- Pure frontend runtime (no Node middleware, no backend server)
- In-memory topology host powered by shared `TopologyHostCore`
- Data persisted between reloads using browser `localStorage`
- Reset action restores seed topologies from `dev/topologies-original/`

## Notes

- VS Code API calls are intercepted by a browser mock
- Webview asset behavior is kept close to extension runtime
- This dev app is intended for UI/product iteration and frontend debugging
