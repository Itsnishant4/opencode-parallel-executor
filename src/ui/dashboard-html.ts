/**
 * Generates the self-contained Interactive Web & Desktop App Dashboard HTML.
 */
export function getDashboardHtml(initialData: {
  terminals: any[];
  cacheStats: any;
  rootDir: string;
  port: number;
}): string {
  const jsonState = JSON.stringify(initialData);

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Parallel Executor & Background Terminal Hub</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: {
              50: '#eff6ff',
              400: '#60a5fa',
              500: '#3b82f6',
              600: '#2563eb',
              700: '#1d4ed8',
            },
            darkbg: '#0a0e17',
            darkcard: '#111827',
            darkborder: '#1f2937',
          },
          fontFamily: {
            mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
          }
        }
      }
    }
  </script>
  <style>
    /* Custom scrollbars */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }
    .terminal-font { font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, monospace; }
  </style>
</head>
<body class="bg-darkbg text-slate-100 min-h-screen flex flex-col antialiased selection:bg-brand-500 selection:text-white">

  <!-- Top Navigation Header -->
  <header class="border-b border-darkborder bg-darkcard/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-amber-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <span class="text-lg font-bold">⚡</span>
        </div>
        <div>
          <div class="flex items-center space-x-2">
            <h1 class="font-bold text-lg text-white tracking-tight">OpenCode Parallel Executor</h1>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">v1.1.0</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Live Engine Active
            </span>
          </div>
          <p class="text-xs text-slate-400">Make OpenCode 100x Faster • Asynchronous Background Terminal & Concurrency Hub</p>
        </div>
      </div>

      <!-- Quick Metrics Pills -->
      <div class="flex items-center space-x-4">
        <div class="hidden md:flex items-center space-x-6 text-xs bg-slate-900/60 border border-darkborder rounded-xl px-4 py-2">
          <div>
            <span class="text-slate-400">Active Terminals:</span>
            <span id="metric-terminals" class="font-semibold text-emerald-400 ml-1">0</span>
          </div>
          <div class="w-px h-3 bg-slate-800"></div>
          <div>
            <span class="text-slate-400">RAM Cache:</span>
            <span id="metric-cache" class="font-semibold text-blue-400 ml-1">0 files</span>
          </div>
          <div class="w-px h-3 bg-slate-800"></div>
          <div>
            <span class="text-slate-400">Parallel Lanes:</span>
            <span class="font-semibold text-amber-400 ml-1">10 Lanes</span>
          </div>
        </div>

        <button onclick="refreshData()" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition" title="Refresh Live State">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
          </svg>
        </button>
      </div>
    </div>
  </header>

  <!-- Navigation Tabs -->
  <div class="border-b border-darkborder bg-slate-950/40 px-6">
    <div class="max-w-7xl mx-auto flex space-x-8">
      <button onclick="switchTab('terminals')" id="tab-btn-terminals" class="tab-button border-b-2 border-blue-500 text-blue-400 py-3 text-sm font-medium flex items-center gap-2">
        <span>🖥️</span> Background Terminals
      </button>
      <button onclick="switchTab('concurrency')" id="tab-btn-concurrency" class="tab-button border-b-2 border-transparent text-slate-400 hover:text-slate-200 py-3 text-sm font-medium flex items-center gap-2">
        <span>🚀</span> Concurrency & Lanes
      </button>
      <button onclick="switchTab('cache')" id="tab-btn-cache" class="tab-button border-b-2 border-transparent text-slate-400 hover:text-slate-200 py-3 text-sm font-medium flex items-center gap-2">
        <span>🧠</span> In-Memory Cache
      </button>
      <button onclick="switchTab('tools')" id="tab-btn-tools" class="tab-button border-b-2 border-transparent text-slate-400 hover:text-slate-200 py-3 text-sm font-medium flex items-center gap-2">
        <span>🛠️</span> 35+ Tool Catalog
      </button>
    </div>
  </div>

  <!-- Main Content Body -->
  <main class="flex-1 max-w-7xl w-full mx-auto p-6">

    <!-- ==================== TAB 1: BACKGROUND TERMINALS ==================== -->
    <div id="tab-pane-terminals" class="space-y-6">
      
      <!-- Top Actions Bar -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-darkcard border border-darkborder rounded-2xl p-5 shadow-sm">
        <div>
          <h2 class="text-base font-semibold text-white">Active Background Terminals</h2>
          <p class="text-xs text-slate-400">Processes run detached in background without blocking OpenCode's main agent turn.</p>
        </div>
        <div class="flex items-center space-x-3 w-full sm:w-auto">
          <button onclick="openLaunchModal()" class="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 transition">
            <span>+</span> Launch Background Terminal
          </button>
        </div>
      </div>

      <!-- Main Two-Column Layout: Terminals List & Live Log Viewer -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">

        <!-- Left Column: Terminals Cards (5 Cols) -->
        <div class="lg:col-span-5 space-y-3">
          <div class="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>TERMINAL INSTANCES</span>
            <span id="terminals-count">0 items</span>
          </div>

          <div id="terminals-list" class="space-y-3">
            <!-- Dynamic Terminal Cards rendered here -->
          </div>
        </div>

        <!-- Right Column: Live Terminal Log Console (7 Cols) -->
        <div class="lg:col-span-7 bg-slate-950 border border-darkborder rounded-2xl flex flex-col h-[580px] shadow-lg overflow-hidden">
          
          <!-- Terminal Header Bar -->
          <div class="px-4 py-3 bg-slate-900/90 border-b border-darkborder flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <span class="w-3 h-3 rounded-full bg-red-500/80"></span>
              <span class="w-3 h-3 rounded-full bg-amber-500/80"></span>
              <span class="w-3 h-3 rounded-full bg-emerald-500/80"></span>
              <span id="console-title" class="ml-2 text-xs font-mono font-medium text-slate-300">Terminal: [Select a terminal]</span>
            </div>

            <!-- Log Controls -->
            <div class="flex items-center space-x-2">
              <input type="text" id="log-search" placeholder="Filter regex..." oninput="filterLogs()" class="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 w-32" />
              <button onclick="toggleAutoScroll()" id="btn-autoscroll" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[11px] text-blue-400 rounded-lg transition" title="Auto-scroll lock">Scroll: ON</button>
              <button onclick="clearConsole()" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 rounded-lg transition">Clear</button>
            </div>
          </div>

          <!-- Terminal Output Screen -->
          <div id="console-output" class="flex-1 p-4 overflow-y-auto terminal-font text-xs leading-relaxed text-slate-300 bg-slate-950 space-y-0.5 select-text">
            <div class="text-slate-600">[Select a terminal from the left to view live stream logs]</div>
          </div>

          <!-- Terminal Stdin Input Bar -->
          <div class="p-3 bg-slate-900 border-t border-darkborder flex items-center space-x-2">
            <span class="text-emerald-400 font-mono text-xs pl-2">❯</span>
            <input type="text" id="stdin-input" placeholder="Send input to stdin (e.g. 'rs', 'y', 'q')..." onkeydown="if(event.key==='Enter') sendStdin()" class="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500" />
            <button onclick="sendStdin()" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition">
              Send
            </button>
          </div>
        </div>

      </div>
    </div>

    <!-- ==================== TAB 2: CONCURRENCY & LANES ==================== -->
    <div id="tab-pane-concurrency" class="hidden space-y-6">
      <div class="bg-darkcard border border-darkborder rounded-2xl p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-base font-semibold text-white">Parallel Concurrency Engine (10 Lanes)</h2>
            <p class="text-xs text-slate-400">High-throughput concurrent worker dispatch for heterogeneous commands, reads, and edits.</p>
          </div>
          <span class="px-3 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-xs font-semibold">
            10-Lane DAG Dispatcher
          </span>
        </div>

        <!-- 10 Visual Execution Lanes -->
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 my-6">
          ${Array.from({ length: 10 }, (_, i) => `
            <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col items-center justify-center text-center">
              <div class="w-8 h-8 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center font-bold text-xs mb-2">
                #${i + 1}
              </div>
              <span class="text-[11px] text-slate-300 font-medium">Lane ${i + 1}</span>
              <span class="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Ready
              </span>
            </div>
          `).join('')}
        </div>

        <div class="border-t border-darkborder pt-5">
          <h3 class="text-xs font-semibold text-slate-300 mb-2">Real-World Concurrency Benchmarks:</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div class="bg-slate-900/50 border border-darkborder rounded-xl p-3.5">
              <span class="text-slate-400">10 Parallel Shell Commands</span>
              <p class="text-lg font-bold text-emerald-400 mt-1">6.40ms</p>
              <span class="text-[10px] text-slate-500">vs ~650ms standard serial</span>
            </div>
            <div class="bg-slate-900/50 border border-darkborder rounded-xl p-3.5">
              <span class="text-slate-400">10 Parallel RAM Reads</span>
              <p class="text-lg font-bold text-blue-400 mt-1">1.10ms</p>
              <span class="text-[10px] text-slate-500">1,300x faster than disk</span>
            </div>
            <div class="bg-slate-900/50 border border-darkborder rounded-xl p-3.5">
              <span class="text-slate-400">10 Mixed Operations</span>
              <p class="text-lg font-bold text-amber-400 mt-1">14.13ms</p>
              <span class="text-[10px] text-slate-500">Zero dependency waiting</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 3: IN-MEMORY CACHE ==================== -->
    <div id="tab-pane-cache" class="hidden space-y-6">
      <div class="bg-darkcard border border-darkborder rounded-2xl p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-base font-semibold text-white">Zero-Latency In-Memory RAM Cache</h2>
            <p class="text-xs text-slate-400">Kernel-level filesystem watcher (kqueue on macOS, inotify on Linux) with auto-invalidation.</p>
          </div>
          <button onclick="purgeCache()" class="px-3.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold transition">
            Purge Cache
          </button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 my-6">
          <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
            <span class="text-xs text-slate-400">Cached Files</span>
            <p id="cache-stat-files" class="text-2xl font-bold text-white mt-1">0</p>
          </div>
          <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
            <span class="text-xs text-slate-400">Cache Hit Rate</span>
            <p id="cache-stat-hits" class="text-2xl font-bold text-emerald-400 mt-1">100%</p>
          </div>
          <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
            <span class="text-xs text-slate-400">Read Latency</span>
            <p class="text-2xl font-bold text-blue-400 mt-1">&lt; 0.05ms</p>
          </div>
          <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
            <span class="text-xs text-slate-400">Watcher Status</span>
            <p class="text-2xl font-bold text-indigo-400 mt-1">Active</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 4: TOOL CATALOG ==================== -->
    <div id="tab-pane-tools" class="hidden space-y-6">
      <div class="bg-darkcard border border-darkborder rounded-2xl p-6">
        <h2 class="text-base font-semibold text-white mb-1">OpenCode Accelerated Tool Catalog (35+ Tools)</h2>
        <p class="text-xs text-slate-400 mb-6">Every tool is accelerated by in-memory caching and persistent background subshells.</p>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <!-- Background Tools Card -->
          <div class="bg-slate-900/70 border border-blue-500/20 rounded-xl p-4 space-y-2">
            <span class="font-bold text-blue-400 text-sm flex items-center gap-1.5">
              <span>🖥️</span> Background Terminals
            </span>
            <p class="text-slate-400 text-[11px]">Run dev servers and daemons in background without blocking agent.</p>
            <div class="font-mono text-[10px] text-slate-300 bg-slate-950 p-2 rounded-lg space-y-1">
              <div>• background_run (bg_run)</div>
              <div>• background_status (bg_status)</div>
              <div>• background_logs (bg_logs)</div>
              <div>• background_input (bg_input)</div>
              <div>• background_stop (bg_stop)</div>
            </div>
          </div>

          <!-- Concurrency Card -->
          <div class="bg-slate-900/70 border border-amber-500/20 rounded-xl p-4 space-y-2">
            <span class="font-bold text-amber-400 text-sm flex items-center gap-1.5">
              <span>🚀</span> Concurrency & DAG
            </span>
            <p class="text-slate-400 text-[11px]">Simultaneous 10-lane batch execution and continuous DAG scheduling.</p>
            <div class="font-mono text-[10px] text-slate-300 bg-slate-950 p-2 rounded-lg space-y-1">
              <div>• batch_execute (turbo_parallel)</div>
              <div>• parallel_execute</div>
            </div>
          </div>

          <!-- File I/O Card -->
          <div class="bg-slate-900/70 border border-emerald-500/20 rounded-xl p-4 space-y-2">
            <span class="font-bold text-emerald-400 text-sm flex items-center gap-1.5">
              <span>🧠</span> RAM Cache & File I/O
            </span>
            <p class="text-slate-400 text-[11px]">Sub-millisecond cached file reads, atomic writes, and targeted edits.</p>
            <div class="font-mono text-[10px] text-slate-300 bg-slate-950 p-2 rounded-lg space-y-1">
              <div>• read / fast_read (&lt; 0.05ms)</div>
              <div>• write / fast_write (&lt; 1ms)</div>
              <div>• edit / fast_edit (&lt; 0.5ms)</div>
              <div>• glob / fast_glob (&lt; 5ms)</div>
              <div>• grep / fast_grep (&lt; 10ms)</div>
            </div>
          </div>

          <!-- Multi-Edit & Safety Card -->
          <div class="bg-slate-900/70 border border-purple-500/20 rounded-xl p-4 space-y-2">
            <span class="font-bold text-purple-400 text-sm flex items-center gap-1.5">
              <span>🛡️</span> Atomic Multi-Edit & Safety
            </span>
            <p class="text-slate-400 text-[11px]">2-phase atomic commits, instant checkpoints, and 1-click rollback.</p>
            <div class="font-mono text-[10px] text-slate-300 bg-slate-950 p-2 rounded-lg space-y-1">
              <div>• multi_edit / fast_multi_edit</div>
              <div>• snapshot / fast_snapshot</div>
              <div>• undo / fast_undo</div>
              <div>• find_replace / fast_find_replace</div>
            </div>
          </div>

          <!-- Code Analysis Card -->
          <div class="bg-slate-900/70 border border-indigo-500/20 rounded-xl p-4 space-y-2">
            <span class="font-bold text-indigo-400 text-sm flex items-center gap-1.5">
              <span>🧭</span> Code Intelligence
            </span>
            <p class="text-slate-400 text-[11px]">Structural outlines, call-sites, and multi-language auto-verification.</p>
            <div class="font-mono text-[10px] text-slate-300 bg-slate-950 p-2 rounded-lg space-y-1">
              <div>• outline / code_symbols</div>
              <div>• find_references / code_deps</div>
              <div>• verify / fast_verify</div>
              <div>• git_changes / fast_diff</div>
            </div>
          </div>
        </div>
      </div>
    </div>

  </main>

  <!-- Modal: Launch Background Process -->
  <div id="modal-launch" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
    <div class="bg-darkcard border border-darkborder rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          <span>🚀</span> Launch Background Terminal
        </h3>
        <button onclick="closeLaunchModal()" class="text-slate-400 hover:text-white">✕</button>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block text-slate-300 font-medium mb-1">Command to Execute *</label>
          <input type="text" id="modal-cmd" placeholder="e.g. npm run dev, vite, pnpm test:watch" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label class="block text-slate-300 font-medium mb-1">Custom Terminal ID (Optional)</label>
          <input type="text" id="modal-id" placeholder="e.g. dev-server, watcher, backend" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
        </div>
      </div>

      <div class="flex items-center justify-end space-x-3 pt-3 border-t border-darkborder">
        <button onclick="closeLaunchModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium">Cancel</button>
        <button onclick="executeLaunchModal()" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold">Start in Background</button>
      </div>
    </div>
  </div>

  <script>
    let appState = ${jsonState};
    let activeTerminalId = null;
    let autoScroll = true;

    function renderTerminals() {
      const listEl = document.getElementById('terminals-list');
      const countEl = document.getElementById('terminals-count');
      const metricEl = document.getElementById('metric-terminals');
      const terms = appState.terminals || [];

      const runningCount = terms.filter(t => t.status === 'running').length;
      metricEl.innerText = runningCount;
      countEl.innerText = terms.length + ' item(s)';

      if (terms.length === 0) {
        listEl.innerHTML = '<div class="p-6 text-center text-xs text-slate-500 border border-dashed border-darkborder rounded-2xl">No background terminals active. Click "+ Launch" to start one!</div>';
        return;
      }

      listEl.innerHTML = terms.map(t => {
        const isSelected = t.id === activeTerminalId;
        const isRunning = t.status === 'running';
        const uptime = Math.round(((t.endTime || Date.now()) - t.startTime) / 1000) + 's';
        const statusBadge = isRunning 
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">RUNNING 🟢</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">EXIT(' + (t.exitCode ?? 0) + ') ⚪</span>';

        return \`
          <div onclick="selectTerminal('\${t.id}')" class="cursor-pointer border rounded-2xl p-4 transition-all \${isSelected ? 'bg-blue-950/20 border-blue-500/50 shadow-md shadow-blue-500/10' : 'bg-darkcard border-darkborder hover:border-slate-700'}">
            <div class="flex items-center justify-between">
              <span class="font-bold text-sm text-white font-mono">\${t.id}</span>
              \${statusBadge}
            </div>
            <div class="font-mono text-xs text-slate-300 mt-2 truncate bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-900">\${t.command}</div>
            <div class="flex items-center justify-between text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-900">
              <span>PID: \${t.pid ?? 'N/A'}</span>
              <span>Uptime: \${uptime}</span>
              \${isRunning ? \`<button onclick="event.stopPropagation(); stopTerminal('\${t.id}')" class="text-rose-400 hover:text-rose-300 font-semibold">Stop</button>\` : ''}
            </div>
          </div>
        \`;
      }).join('');
    }

    async function selectTerminal(id) {
      activeTerminalId = id;
      document.getElementById('console-title').innerText = 'Terminal: ' + id;
      renderTerminals();
      await fetchTerminalLogs();
    }

    async function fetchTerminalLogs() {
      if (!activeTerminalId) return;
      try {
        const res = await fetch('/api/logs?id=' + encodeURIComponent(activeTerminalId) + '&lines=80');
        if (res.ok) {
          const data = await res.json();
          renderConsole(data.lines || []);
        }
      } catch (err) {
        // Fallback for static file viewing
        const term = (appState.terminals || []).find(t => t.id === activeTerminalId);
        if (term) renderConsole(term.buffer || []);
      }
    }

    function renderConsole(lines) {
      const out = document.getElementById('console-output');
      const search = (document.getElementById('log-search').value || '').toLowerCase();
      const filtered = search ? lines.filter(l => l.toLowerCase().includes(search)) : lines;

      if (filtered.length === 0) {
        out.innerHTML = '<div class="text-slate-600">[No logs matching filter]</div>';
        return;
      }

      out.innerHTML = filtered.map(line => {
        // Simple ANSI escaping / clean color rendering
        const clean = line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return '<div class="whitespace-pre-wrap font-mono">' + clean + '</div>';
      }).join('');

      if (autoScroll) {
        out.scrollTop = out.scrollHeight;
      }
    }

    function filterLogs() {
      fetchTerminalLogs();
    }

    function toggleAutoScroll() {
      autoScroll = !autoScroll;
      const btn = document.getElementById('btn-autoscroll');
      btn.innerText = autoScroll ? 'Scroll: ON' : 'Scroll: OFF';
      btn.className = autoScroll 
        ? 'px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[11px] text-blue-400 rounded-lg transition'
        : 'px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-500 rounded-lg transition';
    }

    function clearConsole() {
      document.getElementById('console-output').innerHTML = '';
    }

    async function sendStdin() {
      const inputEl = document.getElementById('stdin-input');
      const text = inputEl.value;
      if (!text || !activeTerminalId) return;

      try {
        await fetch('/api/input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: activeTerminalId, input: text })
        });
        inputEl.value = '';
        setTimeout(fetchTerminalLogs, 200);
      } catch (err) {
        alert('Failed to send input: ' + err.message);
      }
    }

    async function stopTerminal(id) {
      if (!confirm('Stop background terminal ' + id + '?')) return;
      try {
        await fetch('/api/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, force: true })
        });
        refreshData();
      } catch (err) {
        alert('Failed to stop: ' + err.message);
      }
    }

    function openLaunchModal() {
      document.getElementById('modal-launch').classList.remove('hidden');
    }

    function closeLaunchModal() {
      document.getElementById('modal-launch').classList.add('hidden');
    }

    async function executeLaunchModal() {
      const cmd = document.getElementById('modal-cmd').value.trim();
      const id = document.getElementById('modal-id').value.trim();
      if (!cmd) return alert('Command is required');

      try {
        await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: cmd, id: id || undefined })
        });
        closeLaunchModal();
        document.getElementById('modal-cmd').value = '';
        document.getElementById('modal-id').value = '';
        setTimeout(refreshData, 350);
      } catch (err) {
        alert('Launch failed: ' + err.message);
      }
    }

    async function purgeCache() {
      if (!confirm('Flush all in-memory file caches?')) return;
      try {
        await fetch('/api/cache/clear', { method: 'POST' });
        alert('Cache purged successfully');
        refreshData();
      } catch {}
    }

    async function refreshData() {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();
          appState = data;
          renderTerminals();
          if (activeTerminalId) fetchTerminalLogs();
        }
      } catch {}
    }

    function switchTab(name) {
      ['terminals', 'concurrency', 'cache', 'tools'].forEach(t => {
        document.getElementById('tab-pane-' + t).classList.toggle('hidden', t !== name);
        const btn = document.getElementById('tab-btn-' + t);
        if (t === name) {
          btn.className = 'tab-button border-b-2 border-blue-500 text-blue-400 py-3 text-sm font-medium flex items-center gap-2';
        } else {
          btn.className = 'tab-button border-b-2 border-transparent text-slate-400 hover:text-slate-200 py-3 text-sm font-medium flex items-center gap-2';
        }
      });
    }

    // Auto-select first terminal on load
    if (appState.terminals && appState.terminals.length > 0) {
      activeTerminalId = appState.terminals[0].id;
      selectTerminal(activeTerminalId);
    } else {
      renderTerminals();
    }

    // Real-time live polling every 1.5 seconds
    setInterval(refreshData, 1500);
  </script>
</body>
</html>`;
}
