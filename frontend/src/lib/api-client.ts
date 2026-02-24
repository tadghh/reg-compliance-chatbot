export type Jurisdiction = "federal" | "province";

export type QueryRequest = {
  query: string;
  top_k?: number;
  jurisdiction?: Jurisdiction;
};

export type WebSearchResult = {
  title: string;
  url: string;
};

export type QueryResponse = {
  answer: string;
  sources: unknown[];
  nodes_retrieved: number;
  relevant_documents: WebSearchResult[];
};

export type HealthResponse = {
  status: string;
  initialized: boolean;
  collection: string;
};

export type UploadResponse = {
  status: string;
  documents_count: number;
  collection: string;
};

export class ApiClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

const defaultBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

class ComplianceApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = defaultBaseUrl) {
    this.baseUrl = baseUrl;
  }

  async query(payload: QueryRequest): Promise<QueryResponse> {
    return this.request<QueryResponse>("/query", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health", {
      method: "GET",
    });
  }

  async upload(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("file", file);
    return this.request<UploadResponse>("/upload", {
      method: "POST",
      body: formData,
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    if (typeof init.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      let detail = "";
      try {
        const errorJson = (await response.json()) as { detail?: string };
        detail = errorJson.detail?.trim() ?? "";
      } catch {}
      throw new ApiClientError(detail || `Request failed (${response.status})`, response.status);
    }

    return (await response.json()) as T;
  }
}

export const apiClient = new ComplianceApiClient();
