const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

function resolvePackageFile(specifier) {
  try {
    return require.resolve(specifier, {
      paths: [__dirname, path.join(__dirname, "packages/ui")]
    });
  } catch {
    return null;
  }
}

const WEBVIEW_ASSET_MANIFEST = {
  reactTopoViewerWebview: "reactTopoViewerWebview.js",
  reactTopoViewerStyles: "reactTopoViewerStyles.css",
  explorerWebview: "containerlabExplorerView.js",
  welcomeWebview: "welcomePageWebview.js",
  inspectWebview: "inspectWebview.js",
  nodeImpairmentsWebview: "nodeImpairmentsWebview.js",
  wiresharkVncWebview: "wiresharkVncWebview.js",
  monacoEditorWorker: "monaco-editor-worker.js",
  monacoJsonWorker: "monaco-json-worker.js",
  maplibreWorker: "maplibre-gl-csp-worker.js"
};

const ignoreCssPlugin = {
  name: "ignore-css",
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, () => ({
      path: "css-stub",
      namespace: "css-stub"
    }));
    build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({
      contents: "",
      loader: "js"
    }));
  }
};

async function copyFonts() {
  const fontDir = path.join(__dirname, "dist/webfonts");
  await fs.promises.mkdir(fontDir, { recursive: true });

  const wiresharkSrc = path.join(
    __dirname,
    "packages/ui/src/assets/images/wireshark_bold.svg"
  );
  if (fs.existsSync(wiresharkSrc)) {
    await fs.promises.copyFile(wiresharkSrc, path.join(fontDir, "wireshark_bold.svg"));
  }

  const codiconCandidates = [
    path.join(
      __dirname,
      "node_modules/monaco-editor/min/vs/base/browser/ui/codicons/codicon/codicon.ttf"
    ),
    path.join(
      __dirname,
      "node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf"
    )
  ];
  for (const codiconSrc of codiconCandidates) {
    if (!fs.existsSync(codiconSrc)) continue;
    await fs.promises.copyFile(codiconSrc, path.join(fontDir, "codicon.ttf"));
    break;
  }
}

async function copyMapLibreWorker() {
  const srcPath = resolvePackageFile("maplibre-gl/dist/maplibre-gl-csp-worker.js");
  if (!srcPath) return;
  const destPath = path.join(__dirname, "dist/maplibre-gl-csp-worker.js");
  if (!fs.existsSync(srcPath)) return;
  await fs.promises.copyFile(srcPath, destPath);
}

async function buildCss() {
  execSync(
    "npx postcss packages/ui/src/styles/global.css -o dist/reactTopoViewerStyles.css",
    { stdio: "inherit" }
  );

  const cssPath = path.join(__dirname, "dist/reactTopoViewerStyles.css");
  let css = await fs.promises.readFile(cssPath, "utf8");

  css = css.replace(
    /url\([^)]*node_modules\/maplibre-gl\/[^)]*\/([^/)]+\.(woff2?|ttf|eot))\)/g,
    "url(webfonts/$1)"
  );

  css = css.replace(
    /url\((\"|')?\.\.\/base\/browser\/ui\/codicons\/codicon\/codicon\.ttf(\")?\)/g,
    "url(webfonts/codicon.ttf)"
  );

  await fs.promises.writeFile(cssPath, css);
}

async function writePackageManifest() {
  await fs.promises.writeFile(
    path.join(__dirname, "dist/manifest.json"),
    `${JSON.stringify(WEBVIEW_ASSET_MANIFEST, null, 2)}\n`
  );
}

async function copyPackageTypes() {
  await fs.promises.copyFile(
    path.join(__dirname, "src/package/index.d.ts"),
    path.join(__dirname, "dist/index.d.ts")
  );
}

async function build() {
  const isDev = process.argv.includes("--dev");

  await fs.promises.mkdir(path.join(__dirname, "dist"), { recursive: true });

  const commonOptions = {
    bundle: true,
    minify: !isDev,
    treeShaking: true,
    sourcemap: isDev ? "inline" : false,
    logLevel: "info"
  };

  const webviewBuilds = [
    {
      entryPoints: ["packages/ui/src/entry.tsx"],
      outfile: "dist/reactTopoViewerWebview.js"
    },
    {
      entryPoints: ["packages/ui/src/explorer/entry.tsx"],
      outfile: "dist/containerlabExplorerView.js"
    },
    {
      entryPoints: ["packages/ui/src/webviews/welcome/welcomePage.webview.tsx"],
      outfile: "dist/welcomePageWebview.js"
    },
    {
      entryPoints: ["packages/ui/src/inspect/entry.tsx"],
      outfile: "dist/inspectWebview.js"
    },
    {
      entryPoints: ["packages/ui/src/webviews/nodeImpairments/nodeImpairments.webview.tsx"],
      outfile: "dist/nodeImpairmentsWebview.js"
    },
    {
      entryPoints: ["packages/ui/src/webviews/wiresharkVnc/wiresharkVnc.webview.tsx"],
      outfile: "dist/wiresharkVncWebview.js"
    }
  ].map((build) =>
    esbuild.build({
      ...commonOptions,
      entryPoints: build.entryPoints,
      platform: "browser",
      format: "iife",
      target: ["es2020", "chrome90", "firefox90", "safari14"],
      outfile: build.outfile,
      plugins: [ignoreCssPlugin],
      jsx: "automatic",
      loader: {
        ".svg": "dataurl",
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".gif": "dataurl"
      },
      define: {
        "process.env.NODE_ENV": isDev ? '"development"' : '"production"'
      }
    })
  );

  const monacoWorkersBuild = esbuild.build({
    ...commonOptions,
    entryPoints: {
      "monaco-editor-worker": "node_modules/monaco-editor/esm/vs/editor/editor.worker.js",
      "monaco-json-worker": "node_modules/monaco-editor/esm/vs/language/json/json.worker.js"
    },
    platform: "browser",
    format: "iife",
    target: ["es2020", "chrome90", "firefox90", "safari14"],
    outdir: "dist",
    plugins: [ignoreCssPlugin]
  });

  const packageEntryBuild = esbuild.build({
    ...commonOptions,
    entryPoints: ["src/package/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node20"],
    outfile: "dist/index.js"
  });

  await Promise.all([...webviewBuilds, monacoWorkersBuild, packageEntryBuild]);

  await Promise.all([
    buildCss(),
    copyMapLibreWorker(),
    copyFonts(),
    writePackageManifest(),
    copyPackageTypes()
  ]);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
