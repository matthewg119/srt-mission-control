const GHL_API_KEY = process.env.GHL_API_KEY!;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!;
const GHL_PIPELINE_ID = "Jhkxtrseqgm1qwMJGe7A";

const GHL_HEADERS = {
  "Authorization": `Bearer ${GHL_API_KEY}`,
  "Content-Type": "application/json",
  "Version": "2021-07-28",
};

export async function ghlUpsertContact(data: {
  firstName?: string; lastName?: string; email?: string;
  phone?: string; businessName?: string; source?: string;
  tags?: string[];
}) {
  const res = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
    method: "POST",
    headers: GHL_HEADERS,
    body: JSON.stringify({
      locationId: GHL_LOCATION_ID,
      firstName: data.firstName || "",
      lastName: data.lastName || "",
      email: data.email,
      phone: data.phone,
      companyName: data.businessName,
      source: data.source || "Website - Application Form",
      tags: data.tags || ["application-started"],
    }),
  });
  const json = await res.json();
  // GHL upsert returns { contact: { id, ... } }
  return (json.contact?.id || json.id) as string | null;
}

export async function ghlGetPipelineStages(): Promise<{ id: string; name: string }[]> {
  const res = await fetch(
    `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`,
    { headers: GHL_HEADERS }
  );
  const json = await res.json();
  const pipeline = json.pipelines?.find((p: { id: string }) => p.id === GHL_PIPELINE_ID);
  return pipeline?.stages || [];
}

export async function ghlCreateOpportunity(data: {
  ghlContactId: string;
  name: string;
  stageId: string;
  amount?: number;
  source?: string;
}) {
  const res = await fetch("https://services.leadconnectorhq.com/opportunities/", {
    method: "POST",
    headers: GHL_HEADERS,
    body: JSON.stringify({
      locationId: GHL_LOCATION_ID,
      pipelineId: GHL_PIPELINE_ID,
      pipelineStageId: data.stageId,
      contactId: data.ghlContactId,
      name: data.name,
      monetaryValue: data.amount || 0,
      source: data.source || "Website - Application Form",
      status: "open",
    }),
  });
  const json = await res.json();
  return json.opportunity?.id as string | null;
}

export async function ghlUpdateOpportunity(opportunityId: string, data: {
  stageId?: string; amount?: number; status?: string;
}) {
  await fetch(`https://services.leadconnectorhq.com/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: GHL_HEADERS,
    body: JSON.stringify({
      pipelineStageId: data.stageId,
      monetaryValue: data.amount,
      status: data.status || "open",
    }),
  });
}