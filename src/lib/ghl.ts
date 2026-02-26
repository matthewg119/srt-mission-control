const BASE_URL = "https://services.leadconnectorhq.com";

class GHLClient {
  private apiKey: string;
  private locationId: string;

  constructor() {
    this.apiKey = process.env.GHL_API_KEY || "";
    this.locationId = process.env.GHL_LOCATION_ID || "";
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("retry-after") || "2", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request(endpoint, options);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GHL API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Pipeline
  async createPipeline(name: string, stages: { name: string }[]): Promise<Record<string, unknown>> {
    return this.request(`/opportunities/pipelines`, {
      method: "POST",
      body: JSON.stringify({
        locationId: this.locationId,
        name,
        stages: stages.map((s, i) => ({ name: s.name, position: i })),
      }),
    });
  }

  async getPipelines(): Promise<Record<string, unknown>> {
    return this.request(`/opportunities/pipelines?locationId=${this.locationId}`);
  }

  async getOpportunities(pipelineId: string): Promise<Record<string, unknown>> {
    return this.request(
      `/opportunities/search?location_id=${this.locationId}&pipeline_id=${pipelineId}`
    );
  }

  // Custom Fields
  async createCustomField(field: {
    name: string;
    dataType: string;
    model?: string;
    options?: string[];
  }): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      name: field.name,
      dataType: field.dataType,
      model: field.model || "contact",
    };
    if (field.options) {
      body.options = field.options;
    }
    return this.request(`/locations/${this.locationId}/customFields`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getCustomFields(): Promise<Record<string, unknown>> {
    return this.request(`/locations/${this.locationId}/customFields`);
  }

  // Contacts
  async createContact(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(`/contacts/`, {
      method: "POST",
      body: JSON.stringify({ ...data, locationId: this.locationId }),
    });
  }

  async updateContact(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(`/contacts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async searchContacts(query: string): Promise<Record<string, unknown>> {
    return this.request(
      `/contacts/search?locationId=${this.locationId}&query=${encodeURIComponent(query)}`
    );
  }

  // Opportunities
  async createOpportunity(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(`/opportunities/`, {
      method: "POST",
      body: JSON.stringify({ ...data, locationId: this.locationId }),
    });
  }

  async updateOpportunityStage(id: string, stageId: string): Promise<Record<string, unknown>> {
    return this.request(`/opportunities/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ stageId }),
    });
  }

  // Setup helper: creates pipeline + custom fields with delay
  async setupPipelineAndFields(
    stages: { name: string }[],
    customFields: Array<{
      name: string;
      dataType: string;
      options?: string[];
    }>
  ): Promise<{
    pipeline: { status: string; data?: Record<string, unknown>; error?: string };
    customFields: Array<{ name: string; status: string; error?: string }>;
    summary: { created: number; skipped: number; errors: number };
  }> {
    const results = {
      pipeline: { status: "pending" } as { status: string; data?: Record<string, unknown>; error?: string },
      customFields: [] as Array<{ name: string; status: string; error?: string }>,
      summary: { created: 0, skipped: 0, errors: 0 },
    };

    // Create pipeline
    try {
      const pipelineData = await this.createPipeline("Business Loans", stages);
      results.pipeline = { status: "created", data: pipelineData };
      results.summary.created++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already") || msg.includes("409")) {
        results.pipeline = { status: "exists" };
        results.summary.skipped++;
      } else {
        results.pipeline = { status: "error", error: msg };
        results.summary.errors++;
      }
    }

    // Create custom fields with delay
    for (const field of customFields) {
      try {
        await this.createCustomField({
          name: field.name,
          dataType: field.dataType,
          model: "contact",
          options: field.options,
        });
        results.customFields.push({ name: field.name, status: "created" });
        results.summary.created++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("already") || msg.includes("409") || msg.includes("duplicate")) {
          results.customFields.push({ name: field.name, status: "exists" });
          results.summary.skipped++;
        } else {
          results.customFields.push({ name: field.name, status: "error", error: msg });
          results.summary.errors++;
        }
      }
      await this.delay(500); // Rate limit protection
    }

    return results;
  }
}

export const ghl = new GHLClient();
