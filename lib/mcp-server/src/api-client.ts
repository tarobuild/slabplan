export type ApiClientOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  internalSecret?: string;
  /**
   * Optional AbortSignal applied to every fetch issued by this client. When
   * the in-app agent's SSE connection drops mid-turn the orchestrator aborts
   * the controller; any in-flight tool call (often an internal API request
   * that itself talks to the database) immediately rejects rather than
   * running to completion and burning DB time for output the user will never
   * see. Tool handlers do not need to be aware of this — wiring lives at the
   * client level so a single signal cancels every downstream request.
   */
  signal?: AbortSignal;
};

export type ApiRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  toolName?: string;
  idempotencyKey?: string;
  asBase64?: boolean;
};

export type ApiMultipartRequest = {
  path: string;
  body: FormData;
  toolName?: string;
  idempotencyKey?: string;
};

export type ApiResponse<T = unknown> = {
  status: number;
  data: T;
  contentType: string | null;
};

export class ApiError extends Error {
  readonly status: number;
  readonly problem: unknown;
  constructor(status: number, message: string, problem: unknown) {
    super(message);
    this.status = status;
    this.problem = problem;
  }
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly internalSecret: string | undefined;
  private readonly signal: AbortSignal | undefined;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.userAgent = opts.userAgent ?? "cadstone-mcp/0.1";
    this.internalSecret = opts.internalSecret;
    this.signal = opts.signal;
  }

  async request<T = unknown>(req: ApiRequest): Promise<ApiResponse<T>> {
    const url = this.buildUrl(req.path, req.query);
    const headers = this.baseHeaders(req.toolName, req.idempotencyKey);
    headers["Accept"] = "application/json";

    let bodyToSend: string | undefined;
    if (req.body !== undefined && req.body !== null && req.method !== "GET") {
      headers["Content-Type"] = "application/json";
      bodyToSend = JSON.stringify(req.body);
    }

    const res = await this.fetchImpl(url, {
      method: req.method,
      headers,
      body: bodyToSend,
      signal: this.signal,
    });

    return this.parseResponse<T>(res, req.method, req.path, req.asBase64 === true);
  }

  async requestMultipart<T = unknown>(req: ApiMultipartRequest): Promise<ApiResponse<T>> {
    const url = this.buildUrl(req.path);
    const headers = this.baseHeaders(req.toolName, req.idempotencyKey);
    headers["Accept"] = "application/json";

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: req.body,
      signal: this.signal,
    });

    return this.parseResponse<T>(res, "POST", req.path, false);
  }

  private baseHeaders(toolName: string | undefined, idempotencyKey: string | undefined) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "User-Agent": this.userAgent,
    };
    if (toolName) headers["X-MCP-Tool"] = toolName;
    if (this.internalSecret) headers["X-MCP-Internal"] = this.internalSecret;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    return headers;
  }

  private async parseResponse<T>(
    res: Response,
    method: string,
    path: string,
    asBase64: boolean,
  ): Promise<ApiResponse<T>> {
    const contentType = res.headers.get("content-type");

    if (asBase64) {
      const buf = Buffer.from(await res.arrayBuffer());
      const data = buf.toString("base64") as unknown as T;
      if (!res.ok) {
        throw new ApiError(res.status, `${method} ${path} failed (${res.status})`, null);
      }
      return { status: res.status, data, contentType };
    }

    let parsed: unknown = null;
    const text = await res.text();
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const detail =
        typeof parsed === "object" && parsed && "detail" in parsed
          ? String((parsed as { detail?: unknown }).detail ?? "")
          : "";
      const title =
        typeof parsed === "object" && parsed && "title" in parsed
          ? String((parsed as { title?: unknown }).title ?? "")
          : "";
      const message = detail || title || `${method} ${path} failed with status ${res.status}`;
      throw new ApiError(res.status, message, parsed);
    }

    return { status: res.status, data: parsed as T, contentType };
  }

  private buildUrl(path: string, query?: ApiRequest["query"]): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const base = `${this.baseUrl}/api${normalized}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      params.append(key, String(value));
    }
    const qs = params.toString();
    return qs.length > 0 ? `${base}?${qs}` : base;
  }
}
