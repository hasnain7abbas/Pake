import { useState, useEffect, useCallback } from "react";

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: any) => Promise<any> };
      event: { listen: (event: string, handler: (e: any) => void) => Promise<() => void> };
    };
  }
}

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

interface AppConfig {
  url: string;
  name?: string;
  width: number;
  height: number;
  resizable: boolean;
  fullscreen: boolean;
  hideTitleBar: boolean;
  alwaysOnTop: boolean;
  darkMode: boolean;
  showSystemTray: boolean;
  injectCss: string;
  injectJs: string;
}

interface Profile {
  name: string;
  url: string;
  config: AppConfig;
  createdAt: string;
}

interface BatchItem {
  id: number;
  url: string;
  name: string;
}

interface BuildLog {
  message: string;
  type: "info" | "success" | "error";
}

const WINDOW_PRESETS = [
  { label: "Default (1200x780)", width: 1200, height: 780 },
  { label: "Compact (800x600)", width: 800, height: 600 },
  { label: "Wide (1400x900)", width: 1400, height: 900 },
  { label: "Mobile (375x812)", width: 375, height: 812 },
  { label: "Tablet (768x1024)", width: 768, height: 1024 },
  { label: "Square (800x800)", width: 800, height: 800 },
];

const defaultConfig: AppConfig = {
  url: "",
  name: "",
  width: 1200,
  height: 780,
  resizable: true,
  fullscreen: false,
  hideTitleBar: false,
  alwaysOnTop: false,
  darkMode: false,
  showSystemTray: false,
  injectCss: "",
  injectJs: "",
};

type Tab = "build" | "batch" | "profiles" | "inject";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("build");
  const [config, setConfig] = useState<AppConfig>({ ...defaultConfig });
  const [building, setBuilding] = useState(false);
  const [logs, setLogs] = useState<BuildLog[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([]);
  const [batchUrl, setBatchUrl] = useState("");
  const [batchName, setBatchName] = useState("");
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    loadProfiles();
    const unlisten = listen("build-progress", (event: any) => {
      const data = event.payload;
      const type = data.status === "complete" ? "success" : data.status === "error" ? "error" : "info";
      setLogs((prev) => [...prev, { message: data.message, type }]);
      if (data.status === "complete" || data.status === "error") {
        setBuilding(false);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const loadProfiles = async () => {
    try {
      const result = await invoke("list_profiles");
      setProfiles(result as Profile[]);
    } catch {}
  };

  const updateConfig = useCallback((partial: Partial<AppConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleBuild = async () => {
    if (!config.url) return;
    setBuilding(true);
    setLogs([{ message: `Starting build for ${config.name || config.url}...`, type: "info" }]);
    try {
      await invoke("build_app", { config });
    } catch (e: any) {
      setLogs((prev) => [...prev, { message: String(e), type: "error" }]);
      setBuilding(false);
    }
  };

  const handleBatchBuild = async () => {
    if (batchQueue.length === 0) return;
    setBuilding(true);
    setLogs([]);
    for (const item of batchQueue) {
      const batchConfig = { ...config, url: item.url, name: item.name || undefined };
      setLogs((prev) => [...prev, { message: `\n--- Building: ${item.url} ---`, type: "info" }]);
      try {
        await invoke("build_app", { config: batchConfig });
      } catch (e: any) {
        setLogs((prev) => [...prev, { message: `Failed: ${e}`, type: "error" }]);
      }
    }
    setBuilding(false);
  };

  const addBatchItem = () => {
    if (!batchUrl) return;
    setBatchQueue((prev) => [...prev, { id: Date.now(), url: batchUrl, name: batchName }]);
    setBatchUrl("");
    setBatchName("");
  };

  const removeBatchItem = (id: number) => {
    setBatchQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSaveProfile = async () => {
    if (!profileName || !config.url) return;
    try {
      await invoke("save_profile", { name: profileName, url: config.url, config });
      setProfileName("");
      loadProfiles();
    } catch {}
  };

  const handleLoadProfile = (profile: Profile) => {
    setConfig(profile.config);
    setActiveTab("build");
  };

  const handleDeleteProfile = async (name: string) => {
    try {
      await invoke("delete_profile", { name });
      loadProfiles();
    } catch {}
  };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Pake</h1>
          <p>Native App Maker</p>
        </div>
        <nav className="sidebar-nav">
          {([
            ["build", "Build App"],
            ["batch", "Batch Build"],
            ["inject", "CSS / JS"],
            ["profiles", "Profiles"],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`nav-item ${activeTab === key ? "active" : ""}`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        {activeTab === "build" && (
          <>
            <h2>Build a Desktop App</h2>

            <div className="form-section">
              <h3>Target</h3>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Website URL</label>
                  <input
                    type="url"
                    placeholder="https://example.com"
                    value={config.url}
                    onChange={(e) => updateConfig({ url: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>App Name</label>
                  <input
                    type="text"
                    placeholder="MyApp"
                    value={config.name || ""}
                    onChange={(e) => updateConfig({ name: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>Window Size</h3>
              <div className="preset-grid">
                {WINDOW_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className="preset-btn"
                    onClick={() => updateConfig({ width: preset.width, height: preset.height })}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Width (px)</label>
                  <input
                    type="number"
                    value={config.width}
                    onChange={(e) => updateConfig({ width: parseInt(e.target.value) || 1200 })}
                  />
                </div>
                <div className="form-group">
                  <label>Height (px)</label>
                  <input
                    type="number"
                    value={config.height}
                    onChange={(e) => updateConfig({ height: parseInt(e.target.value) || 780 })}
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>Options</h3>
              {([
                ["resizable", "Resizable Window"],
                ["fullscreen", "Start Fullscreen"],
                ["hideTitleBar", "Hide Title Bar"],
                ["alwaysOnTop", "Always on Top"],
                ["darkMode", "Dark Mode"],
                ["showSystemTray", "System Tray Icon"],
              ] as [keyof AppConfig, string][]).map(([key, label]) => (
                <div className="toggle-row" key={key}>
                  <span>{label}</span>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={config[key] as boolean}
                      onChange={(e) => updateConfig({ [key]: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              ))}
            </div>

            <div className="button-row">
              <button className="btn btn-primary" onClick={handleBuild} disabled={building || !config.url}>
                {building ? "Building..." : "Generate .exe"}
              </button>
              <input
                type="text"
                placeholder="Profile name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                style={{ width: 150 }}
              />
              <button className="btn btn-secondary" onClick={handleSaveProfile} disabled={!profileName || !config.url}>
                Save Profile
              </button>
            </div>

            {logs.length > 0 && (
              <div className="build-log">
                {logs.map((log, i) => (
                  <div key={i} className={`log-line ${log.type === "success" ? "log-success" : log.type === "error" ? "log-error" : ""}`}>
                    {log.message}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "batch" && (
          <>
            <h2>Batch Build</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: 16, fontSize: 13 }}>
              Queue multiple URLs and build all apps in one run.
            </p>

            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>URL</label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={batchUrl}
                  onChange={(e) => setBatchUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBatchItem()}
                />
              </div>
              <div className="form-group">
                <label>App Name</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBatchItem()}
                />
              </div>
              <div className="form-group" style={{ flex: 0, justifyContent: "flex-end" }}>
                <label>&nbsp;</label>
                <button className="btn btn-secondary" onClick={addBatchItem}>Add</button>
              </div>
            </div>

            {batchQueue.length === 0 ? (
              <div className="empty-state">
                <p>No apps in queue. Add URLs above to start.</p>
              </div>
            ) : (
              <>
                <ul className="batch-list">
                  {batchQueue.map((item) => (
                    <li key={item.id} className="batch-item">
                      <span className="url">{item.url}</span>
                      {item.name && <span className="name">{item.name}</span>}
                      <button className="remove-btn" onClick={() => removeBatchItem(item.id)}>x</button>
                    </li>
                  ))}
                </ul>
                <div className="button-row">
                  <button className="btn btn-primary" onClick={handleBatchBuild} disabled={building}>
                    {building ? "Building..." : `Build All (${batchQueue.length})`}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setBatchQueue([])}>Clear Queue</button>
                </div>
              </>
            )}

            {logs.length > 0 && (
              <div className="build-log">
                {logs.map((log, i) => (
                  <div key={i} className={`log-line ${log.type === "success" ? "log-success" : log.type === "error" ? "log-error" : ""}`}>
                    {log.message}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "inject" && (
          <>
            <h2>Custom CSS / JS Injection</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: 16, fontSize: 13 }}>
              Inject custom styles or scripts into the packaged app. These will be applied on every page load.
            </p>

            <div className="form-section">
              <h3>Custom CSS</h3>
              <textarea
                rows={8}
                placeholder="body { background: #1a1a1a; color: #fff; }"
                value={config.injectCss}
                onChange={(e) => updateConfig({ injectCss: e.target.value })}
              />
            </div>

            <div className="form-section">
              <h3>Custom JavaScript</h3>
              <textarea
                rows={8}
                placeholder="console.log('Injected!');"
                value={config.injectJs}
                onChange={(e) => updateConfig({ injectJs: e.target.value })}
              />
            </div>
          </>
        )}

        {activeTab === "profiles" && (
          <>
            <h2>Saved Profiles</h2>
            {profiles.length === 0 ? (
              <div className="empty-state">
                <p>No profiles saved yet.</p>
                <p style={{ fontSize: 12 }}>Build an app and click "Save Profile" to save its configuration for later.</p>
              </div>
            ) : (
              <div className="profile-grid">
                {profiles.map((p) => (
                  <div key={p.name} className="profile-card" onClick={() => handleLoadProfile(p)}>
                    <h4>{p.name}</h4>
                    <div className="profile-url">{p.url}</div>
                    <div className="profile-actions">
                      <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={(e) => { e.stopPropagation(); handleLoadProfile(p); }}>
                        Load
                      </button>
                      <button className="btn btn-danger" style={{ padding: "4px 10px", fontSize: 11 }} onClick={(e) => { e.stopPropagation(); handleDeleteProfile(p.name); }}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
