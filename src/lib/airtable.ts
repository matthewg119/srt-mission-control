const BASE_URL = "https://api.airtable.com/v0";

function headers() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function baseId() {
  const id = process.env.AIRTABLE_BASE_ID;
  if (!id) throw new Error("AIRTABLE_BASE_ID not set");
  return id;
}

export async function getRecord(tableId: string, recordId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/${baseId()}/${tableId}/${recordId}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Airtable getRecord failed: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function createRecord(tableId: string, fields: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE_URL}/${baseId()}/${tableId}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable createRecord failed: ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function createRecords(tableId: string, records: Array<{ fields: Record<string, unknown> }>): Promise<string[]> {
  // Airtable allows max 10 records per batch
  const ids: string[] = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const res = await fetch(`${BASE_URL}/${baseId()}/${tableId}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ records: batch }),
    });
    if (!res.ok) throw new Error(`Airtable createRecords failed: ${await res.text()}`);
    const data = (await res.json()) as { records: Array<{ id: string }> };
    ids.push(...data.records.map((r) => r.id));
  }
  return ids;
}

export async function updateRecord(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE_URL}/${baseId()}/${tableId}/${recordId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable updateRecord failed: ${await res.text()}`);
}

// Upload a binary attachment directly to an Airtable record field.
// base64Data should be the raw base64 string (no data: prefix).
export async function uploadAttachment(
  tableId: string,
  recordId: string,
  fieldId: string,
  filename: string,
  base64Data: string,
  contentType: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/${baseId()}/${tableId}/${recordId}/attachments`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      fieldId,
      file: {
        name: filename,
        type: contentType,
        data: base64Data,
      },
    }),
  });
  if (!res.ok) throw new Error(`Airtable uploadAttachment failed: ${await res.text()}`);
}

// Section mapping: slide index (1-based) → kanban column name
export function slideSection(slideNumber: number): string {
  if (slideNumber <= 2) return "Hook";
  if (slideNumber <= 4) return "Avatar";
  if (slideNumber <= 7) return "Meat & Potatoes";
  return "CTA";
}
