export declare class WebDashboardServer {
    private static instance;
    private server;
    private activePort;
    private rootDir;
    private isStarting;
    private constructor();
    static getInstance(rootDir?: string): WebDashboardServer;
    /**
     * Starts the local dashboard HTTP server if not already running.
     */
    start(preferredPort?: number): Promise<{
        url: string;
        port: number;
    }>;
    private bindServer;
    private handleRequest;
    private getCurrentState;
    saveStaticFile(port: number): Promise<string>;
    openInBrowser(url: string): void;
    stop(): Promise<void>;
}
//# sourceMappingURL=web-dashboard.d.ts.map