/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CADENCEGATE_ADDRESS?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_SDK_PACKAGE?: string;
  readonly VITE_CONTRACT_SOURCE?: string;
  readonly VITE_SOURCE_DOCUMENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
