// Template variable renderer for SMS/Email templates
// Variables use {{variable_name}} syntax

export const TEMPLATE_VARIABLES = [
  { key: "contact_name", label: "Contact Name", example: "John Smith" },
  { key: "first_name", label: "First Name", example: "John" },
  { key: "business_name", label: "Business Name", example: "Smith Construction LLC" },
  { key: "funding_amount", label: "Funding Amount", example: "$50,000" },
  { key: "approved_amount", label: "Approved Amount", example: "$45,000" },
  { key: "approved_lender", label: "Approved Lender", example: "BlueVine" },
  { key: "agent_name", label: "Agent Name", example: "Benjamin" },
  { key: "agent_phone", label: "Agent Phone", example: "(555) 123-4567" },
  { key: "agent_email", label: "Agent Email", example: "benjamin@srtagency.com" },
  { key: "company_name", label: "Company Name", example: "SRT Agency" },
  { key: "stage_name", label: "Current Stage", example: "Contract In" },
  { key: "pipeline_name", label: "Pipeline", example: "Active Deals" },
] as const;

export type TemplateVariableKey = (typeof TEMPLATE_VARIABLES)[number]["key"];

export interface TemplateContext {
  [key: string]: string | undefined;
}

/**
 * Render a template string by replacing {{variable}} placeholders with values
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return context[key] || match;
  });
}

/**
 * Extract all variable keys used in a template string
 */
export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set(Array.from(matches, (m) => m[1]))];
}

/**
 * Preview a template with example values
 */
export function previewTemplate(template: string): string {
  const exampleContext: TemplateContext = {};
  for (const v of TEMPLATE_VARIABLES) {
    exampleContext[v.key] = v.example;
  }
  return renderTemplate(template, exampleContext);
}
