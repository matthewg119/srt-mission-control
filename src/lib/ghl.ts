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

  /**
   * Create a contact, or return the existing one if duplicate.
   * GHL returns 400/422 with the existing contact info on duplicates.
   */
  async createOrFindContact(data: Record<string, unknown>): Promise<{ contactId: string; isNew: boolean }> {
    try {
      const result = await this.createContact(data);
      const contact = result.contact as Record<string, unknown> | undefined;
      const id = (contact?.id as string) || (result.id as string);
      if (id) return { contactId: id, isNew: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // GHL duplicate error often contains the contact ID in the response
      // Try to extract it from the error message
      const idMatch = errMsg.match(/"id"\s*:\s*"([a-zA-Z0-9]+)"/);
      if (idMatch) return { contactId: idMatch[1], isNew: false };
    }

    // Fallback: search by email or phone
    const email = data.email as string | undefined;
    const phone = data.phone as string | undefined;
    const searchQuery = email || phone;
    if (searchQuery) {
      const searchResult = await this.searchContacts(searchQuery);
      const contacts = (searchResult.contacts as Array<Record<string, unknown>>) || [];
      if (contacts.length > 0) {
        return { contactId: contacts[0].id as string, isNew: false };
      }
    }

    throw new Error("Failed to create or find contact");
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

  // Tags
  async addContactTag(contactId: string, tag: string): Promise<Record<string, unknown>> {
    return this.request(`/contacts/${contactId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tags: [tag] }),
    });
  }

  // Email sending via GHL Conversations API
  async sendEmail(
    contactId: string,
    subject: string,
    htmlBody: string,
  ): Promise<Record<string, unknown>> {
    // Step 1: Create or find a conversation for this contact
    let conversationId: string | null = null;

    try {
      const searchResult = await this.request(
        `/conversations/search?locationId=${this.locationId}&contactId=${contactId}`
      );
      const conversations = (searchResult.conversations as Array<Record<string, unknown>>) || [];
      if (conversations.length > 0) {
        conversationId = conversations[0].id as string;
      }
    } catch {
      // No existing conversation — will create one
    }

    if (!conversationId) {
      const newConv = await this.request(`/conversations/`, {
        method: "POST",
        body: JSON.stringify({
          locationId: this.locationId,
          contactId,
        }),
      });
      conversationId = (newConv.conversation as Record<string, unknown>)?.id as string
        || newConv.id as string;
    }

    // Step 2: Send the email message
    return this.request(`/conversations/messages`, {
      method: "POST",
      body: JSON.stringify({
        type: "Email",
        contactId,
        conversationId,
        subject,
        html: htmlBody,
        emailFrom: `SRT Agency <info@srtagency.com>`,
      }),
    });
  }

  // Document upload (multipart/form-data)
  async uploadContactDocument(
    contactId: string,
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
  ): Promise<Record<string, unknown>> {
    const formData = new FormData();
    formData.append("contactId", contactId);
    formData.append("locationId", this.locationId);
    const blob = new Blob([new Uint8Array(fileBuffer)]);
    formData.append("file", blob, fileName);

    const response = await fetch(`${BASE_URL}/contacts/${contactId}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Version: "2021-07-28",
      },
      body: formData,
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("retry-after") || "2", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.uploadContactDocument(contactId, fileBuffer, fileName);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GHL document upload error ${response.status}: ${error}`);
    }

    return response.json();
  }

  // Get a single contact by ID
  async getContact(contactId: string): Promise<Record<string, unknown>> {
    return this.request(`/contacts/${contactId}`);
  }

  // Add a note to a contact
  async addNote(contactId: string, body: string): Promise<Record<string, unknown>> {
    return this.request(`/contacts/${contactId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body, userId: "system" }),
    });
  }

  // Get notes for a contact
  async getNotes(contactId: string): Promise<Record<string, unknown>> {
    return this.request(`/contacts/${contactId}/notes`);
  }

  // Get documents for a contact (returns empty list if GHL endpoint unavailable)
  async getContactDocuments(contactId: string): Promise<Record<string, unknown>> {
    try {
      return await this.request(`/contacts/${contactId}/documents`);
    } catch {
      return { documents: [] };
    }
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
