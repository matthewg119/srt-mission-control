import { jsPDF } from "jspdf";

interface ApplicationData {
  firstName?: string;
  lastName?: string;
  email?: string;
  businessPhone?: string;
  mobilePhone?: string;
  businessName?: string;
  legalName?: string;
  dba?: string;
  industry?: string;
  ein?: string;
  bizAddress?: string;
  bizCity?: string;
  bizState?: string;
  bizZip?: string;
  incDate?: string;
  dob?: string;
  creditScore?: string;
  ownership?: string;
  ssn4?: string;
  amountNeeded?: string;
  useOfFunds?: string;
  monthlyDeposits?: string;
  existingLoans?: string;
  notes?: string;
  /** Base64 PNG of the drawn signature from canvas */
  signature?: string;
  /** Printed/typed name for the signature line */
  signatureName?: string;
  /** When true, omits mobile phone from the PDF (lender copy) */
  hidePhone?: boolean;
}

/**
 * Generate the SRT Agency Business Funding Application PDF.
 * Mirrors the client-side jsPDF generation from apply/index.html.
 * Returns a Buffer containing the PDF data.
 */
export function generateApplicationPDF(data: ApplicationData): Buffer {
  const doc = new jsPDF();
  const pw = 210;
  const m = 15;
  const cw = pw - m * 2;
  let y = 0;

  // Colors
  const midnight = [11, 20, 38] as const;
  const ocean = [27, 101, 167] as const;
  const slate = [61, 79, 111] as const;
  const reef = [0, 201, 167] as const;
  const gray = [200, 200, 200] as const;

  // ---- HEADER BAR ----
  doc.setFillColor(midnight[0], midnight[1], midnight[2]);
  doc.rect(0, 0, pw, 26, "F");

  doc.setFillColor(reef[0], reef[1], reef[2]);
  doc.rect(0, 26, pw, 1.5, "F");

  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("SRT AGENCY", m, 11);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 195, 215);
  doc.text("Scaling Revenue Together", m, 17);
  doc.setFontSize(7.5);
  doc.text("submissions@srtagency.com  |  srtagency.com", m, 22);

  doc.setFontSize(12);
  doc.setTextColor(reef[0], reef[1], reef[2]);
  doc.setFont("helvetica", "bold");
  doc.text("BUSINESS FUNDING", pw - m, 11, { align: "right" });
  doc.text("APPLICATION", pw - m, 17, { align: "right" });

  y = 33;

  // Date + App ID
  const appId = "SRT-" + Date.now().toString(36).toUpperCase().slice(-6);
  doc.setFontSize(8);
  doc.setTextColor(slate[0], slate[1], slate[2]);
  doc.setFont("helvetica", "normal");
  doc.text("Application ID: " + appId, m, y);
  doc.text("Date: " + new Date().toLocaleDateString(), pw - m, y, { align: "right" });
  y += 6;

  // ---- HELPERS ----
  function secHeader(title: string) {
    doc.setFillColor(ocean[0], ocean[1], ocean[2]);
    doc.rect(m, y, cw, 7, "F");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text(title, m + 3, y + 5);
    y += 9;
  }

  function cell(label: string, value: string | undefined, x: number, w: number, ch = 10) {
    doc.setDrawColor(gray[0], gray[1], gray[2]);
    doc.setLineWidth(0.25);
    doc.rect(x, y, w, ch);
    doc.setFontSize(6);
    doc.setTextColor(130, 130, 130);
    doc.setFont("helvetica", "normal");
    doc.text(label, x + 2, y + 3.5);
    doc.setFontSize(9);
    doc.setTextColor(midnight[0], midnight[1], midnight[2]);
    doc.text(String(value || "\u2014"), x + 2, y + 8);
  }

  function cellRow(fields: Array<[string, string | undefined]>, ch = 10) {
    const w = cw / fields.length;
    fields.forEach((f, i) => {
      cell(f[0], f[1], m + i * w, w, ch);
    });
    y += ch;
  }

  // SECTION 1: BUSINESS INFORMATION
  secHeader("SECTION 1: BUSINESS INFORMATION");
  cellRow([["Legal Business Name", data.businessName || data.legalName], ["DBA (Doing Business As)", data.dba]]);
  cellRow([["Industry", data.industry], ["EIN", data.ein]]);
  cellRow([["Street Address", data.bizAddress]]);
  cellRow([["City", data.bizCity], ["State", data.bizState], ["ZIP Code", data.bizZip]]);
  cellRow([["Date of Incorporation", data.incDate]]);
  y += 3;

  // SECTION 2: OWNER / GUARANTOR INFORMATION
  secHeader("SECTION 2: OWNER / GUARANTOR INFORMATION");
  cellRow([["First Name", data.firstName], ["Last Name", data.lastName]]);
  cellRow(data.hidePhone
    ? [["Email", data.email]]
    : [["Mobile Phone", data.mobilePhone], ["Email", data.email]]);
  cellRow([
    ["Date of Birth", data.dob],
    ["Est. Credit Score", data.creditScore],
    ["Ownership %", data.ownership ? data.ownership + "%" : undefined],
  ]);
  cellRow([["SSN (Last 4 Digits)", data.ssn4 ? "***-**-" + data.ssn4 : undefined]]);
  y += 3;

  // SECTION 3: FUNDING DETAILS
  secHeader("SECTION 3: FUNDING DETAILS");
  cellRow([["Amount Requested", data.amountNeeded], ["Use of Funds", data.useOfFunds]]);
  cellRow([["Avg Monthly Revenue", data.monthlyDeposits], ["Existing Business Loans", data.existingLoans]]);
  if (data.notes) {
    cell("Additional Notes", data.notes, m, cw, 14);
    y += 14;
  }
  y += 4;

  // Check if authorization section needs a new page (needs ~70mm for legal text + signature)
  if (y > 210) {
    doc.addPage();
    y = 15;
  }

  // AUTHORIZATION
  secHeader("AUTHORIZATION & CONSENT");
  y += 2; // spacing below blue header bar

  doc.setFontSize(7);
  doc.setTextColor(slate[0], slate[1], slate[2]);
  doc.setFont("helvetica", "normal");
  const authIntro =
    "By submitting this application, I authorize SRT Agency LLC to collect and process the information provided herein to evaluate my business for funding. I understand that SRT Agency LLC uses AI-powered technology and data analysis to make funding decisions. No hard credit inquiry will be performed as part of this application.";
  const authIntroLines = doc.splitTextToSize(authIntro, cw - 4);
  doc.text(authIntroLines, m + 2, y);
  y += authIntroLines.length * 3.2 + 3;

  // Full legal fine print
  doc.setFontSize(5.5);
  doc.setTextColor(130, 130, 130);
  const legalText =
    "I certify that my answers are true and complete to the best of my knowledge. " +
    "The Business, Merchant, Owner(s) and/or Officer(s) identified above (each, individually, an \"Applicant\") each represents, warrants, acknowledges and " +
    "agrees that all information and documents, including this application, provided to SRT Agency LLC or Recipients in connection with this Possible " +
    "Transaction, including bank and credit card processor statements, are accurate, true, and complete, that Recipients may rely upon the accuracy and " +
    "completeness of such information and documents, and that Applicant is authorized to sign this application agreement. Applicant will immediately notify " +
    "SRT Agency LLC of any change in Applicant information or financial condition. Applicant authorizes SRT Agency LLC and SRT Agency LLC " +
    "agents, employees, independent contractors, funding sources and other representatives (\"Funding Sources\") to disclose to other persons, entities and " +
    "funding sources (each, an \"Assignee\") all Applicant information and documents that SRT Agency LLC, Representatives, and Assignee (collectively, " +
    "\"Recipient\") may obtain, including, Applicant's express authorization of Recipient to request, receive and use any credit reports, investigative reports, " +
    "statements from creditors or financial institutions, verification of information, or any other information that a Recipient deems necessary and each " +
    "Recipient is further authorized to use such information and share such information with other Recipients in connection " +
    "with the placement of commercial loans, including, without limitation, loans having daily repayment features, purchases of future receivables and/or " +
    "Merchant Cash Advance transactions or other commercial loans (collectively, a \"Possible Transaction\"). Applicant unconditionally waives and releases all " +
    "claims against Recipients in connection with a Possible Transaction, arising from any act or omission, except in the case of gross or willfully negligent " +
    "conduct, including, but not limited to, relating to the requesting, receiving or release of an Applicant's information and documents in connection with a " +
    "Possible Transaction. This agreement shall be governed by the Laws of New York, without giving effect to conflicts of law principals, and a copy of this " +
    "agreement may be accepted as an original.";
  const legalLines = doc.splitTextToSize(legalText, cw - 4);
  doc.text(legalLines, m + 2, y);
  y += legalLines.length * 2.4 + 6;

  // Signature section
  if (data.signature) {
    // Embed the drawn signature image above the line
    try {
      doc.addImage(data.signature, "PNG", m, y - 2, 70, 18);
      y += 18;
    } catch {
      // If image fails, fall back to typed name
      if (data.signatureName) {
        doc.setFontSize(14);
        doc.setTextColor(midnight[0], midnight[1], midnight[2]);
        doc.setFont("helvetica", "italic");
        doc.text(data.signatureName, m + 2, y + 10);
        y += 14;
      }
    }
  } else if (data.signatureName) {
    // No drawn signature — render typed name in italic as signature
    doc.setFontSize(14);
    doc.setTextColor(midnight[0], midnight[1], midnight[2]);
    doc.setFont("helvetica", "italic");
    doc.text(data.signatureName, m + 2, y + 10);
    y += 14;
  }

  // Signature lines
  doc.setDrawColor(midnight[0], midnight[1], midnight[2]);
  doc.setLineWidth(0.4);
  doc.line(m, y, m + 80, y);
  doc.line(m + 100, y, pw - m, y);
  y += 4;
  doc.setFontSize(7);
  doc.setTextColor(130, 130, 130);
  doc.setFont("helvetica", "normal");
  doc.text(data.signatureName ? `Signed by: ${data.signatureName}` : "Applicant Signature", m, y);
  doc.text(new Date().toLocaleDateString(), m + 100, y);
  y += 10;

  // Footer
  doc.setDrawColor(reef[0], reef[1], reef[2]);
  doc.setLineWidth(0.6);
  doc.line(m, y, pw - m, y);
  y += 4;
  doc.setFontSize(6.5);
  doc.setTextColor(160, 160, 160);
  doc.text("SRT Agency LLC \u2022 submissions@srtagency.com \u2022 srtagency.com", pw / 2, y, { align: "center" });

  // Return as Buffer
  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
