/**
 * OpenClaw Plugin SDK 类型声明
 */

declare module "openclaw/plugin-sdk" {
  export interface OpenClawConfig {
    channels?: {
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  export interface PluginRuntime {
    getConfig(): OpenClawConfig;
    setConfig(config: OpenClawConfig): void;
    getDataDir(): string;
    channel?: {
      handleIncomingMessage?: (options: unknown) => Promise<unknown>;
      recordInboundSession?: (options: unknown) => void;
    };
    log: {
      info: (message: string, ...args: unknown[]) => void;
      warn: (message: string, ...args: unknown[]) => void;
      error: (message: string, ...args: unknown[]) => void;
      debug: (message: string, ...args: unknown[]) => void;
    };
    [key: string]: unknown;
  }

  export interface OpenClawPluginApi {
    runtime: PluginRuntime;
    registerChannel<TAccount = unknown>(options: { plugin: ChannelPlugin<TAccount> }): void;
    [key: string]: unknown;
  }

  export function emptyPluginConfigSchema(): unknown;

  export interface ChannelPluginMeta {
    id: string;
    label: string;
    selectionLabel?: string;
    docsPath?: string;
    blurb?: string;
    order?: number;
    [key: string]: unknown;
  }

  export interface ChannelPlugin<TAccount = unknown> {
    id: string;
    meta: ChannelPluginMeta;
    pairing?: {
      idLabel: string;
      normalizeAllowEntry?: (entry: string) => string;
      notifyApproval?: (options: { cfg: unknown; id: string }) => Promise<void>;
    };
    setup?: {
      resolveAccountId?: () => string;
      applyAccountConfig?: (options: { cfg: unknown; accountId?: string }) => unknown;
    };
    messaging?: {
      normalizeTarget?: (raw: unknown) => unknown;
      targetResolver?: {
        looksLikeId?: (id: unknown) => boolean;
        hint?: string;
      };
    };
    directory?: {
      self?: (options: unknown) => Promise<unknown>;
      listPeers?: (options: unknown) => Promise<unknown[]>;
      listGroups?: (options: unknown) => Promise<unknown[]>;
    };
    outbound?: {
      send?: (options: {
        cfg: unknown;
        to: string;
        text: string;
        accountId?: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    status?: {
      defaultRuntime?: () => unknown;
      buildChannelSummary?: (options: { snapshot: unknown }) => unknown;
      probeAccount?: (options: { account: TAccount }) => Promise<unknown>;
      buildAccountSnapshot?: (options: { account: TAccount; runtime?: unknown }) => unknown;
    };
    gateway?: {
      startAccount?: (options: {
        cfg: unknown;
        accountId: string;
        runtime?: unknown;
        abortSignal: AbortSignal;
        log?: PluginRuntime["log"];
        setStatus: (status: unknown) => void;
      }) => Promise<void>;
    };
  }
}
