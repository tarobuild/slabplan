#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "../..");
const CREDENTIALS_PATH = resolve(ROOT, "tmp/slabplan-demo-credentials.json");
const STATE_PATH = resolve(ROOT, "tmp/slabplan-demo-provision-state.json");
const PDF_DIR = resolve(ROOT, "output/pdf");
const ORIGIN = (process.env.SLABPLAN_DEMO_ORIGIN || "https://www.slabplan.com").replace(/\/$/, "");
const LEGAL_VERSION = "2026-08-19";
const DEMO_ORGANIZATION_NAME = "TEST - Summit Ridge Stoneworks";
const TEST_PREFIX = "TEST - ";

const ACCOUNTS = {
  admin: {
    fullName: "TEST - Avery Cole (Admin)",
    email: "testadmin@tarobuild.com",
    role: "admin",
  },
  projectManager: {
    fullName: "TEST - Elena Ruiz (Project Manager)",
    email: "testpm@tarobuild.com",
    role: "project_manager",
  },
  crewMember: {
    fullName: "TEST - Marcus Lee (Installer)",
    email: "testcrew@tarobuild.com",
    role: "crew_member",
  },
  drafter: {
    fullName: "TEST - Priya Shah (Drafter)",
    email: "testcad@tarobuild.com",
    role: "drafter",
  },
};

const CLIENTS = [
  {
    key: "harborline",
    companyName: "Harborline Custom Homes",
    phone: "(760) 555-0142",
    email: "projects@harborline.example",
    streetAddress: "73-900 El Paseo, Suite 204",
    city: "Palm Desert",
    state: "CA",
    zipCode: "92260",
    notes: "Luxury residential builder. Prefers weekly cost and schedule updates through SlabPlan.",
    contact: {
      firstName: "Jordan",
      lastName: "Mercer",
      title: "Project Executive",
      email: "jordan.mercer@harborline.example",
      phone: "(760) 555-0142",
      cellPhone: "(760) 555-0118",
      isPrimary: true,
    },
  },
  {
    key: "juniper",
    companyName: "Juniper & Vale Interiors",
    phone: "(760) 555-0136",
    email: "studio@junipervale.example",
    streetAddress: "45-125 San Pablo Avenue",
    city: "Palm Desert",
    state: "CA",
    zipCode: "92260",
    notes: "Interior design studio managing high-end residential stone selections and client approvals.",
    contact: {
      firstName: "Natalie",
      lastName: "Chen",
      title: "Principal Designer",
      email: "natalie.chen@junipervale.example",
      phone: "(760) 555-0136",
      cellPhone: "(760) 555-0129",
      isPrimary: true,
    },
  },
  {
    key: "northgate",
    companyName: "Northgate Commercial Builders",
    phone: "(909) 555-0181",
    email: "estimating@northgatebuilders.example",
    streetAddress: "6400 Meridian Commerce Drive",
    city: "Ontario",
    state: "CA",
    zipCode: "91761",
    notes: "Commercial general contractor. Requires daily logs, formal submittals, and signed field work orders.",
    contact: {
      firstName: "Owen",
      lastName: "Brooks",
      title: "Senior Project Manager",
      email: "owen.brooks@northgatebuilders.example",
      phone: "(909) 555-0181",
      cellPhone: "(909) 555-0174",
      isPrimary: true,
    },
  },
  {
    key: "sonoran",
    companyName: "Sonoran Hospitality Group",
    phone: "(760) 555-0179",
    email: "development@sonoranhospitality.example",
    streetAddress: "68-900 Highway 111, Suite 310",
    city: "Cathedral City",
    state: "CA",
    zipCode: "92234",
    notes: "Restaurant and boutique hospitality operator with phased renovation schedules.",
    contact: {
      firstName: "Camille",
      lastName: "Rios",
      title: "Director of Development",
      email: "camille.rios@sonoranhospitality.example",
      phone: "(760) 555-0179",
      cellPhone: "(760) 555-0165",
      isPrimary: true,
    },
  },
  {
    key: "mesa-modern",
    companyName: "Mesa Modern Development",
    phone: "(480) 555-0107",
    email: "construction@mesamodern.example",
    streetAddress: "7110 East Adobe Street",
    city: "Scottsdale",
    state: "AZ",
    zipCode: "85250",
    notes: "Design-build firm specializing in desert residences and outdoor living packages.",
    contact: {
      firstName: "Theo",
      lastName: "Barnes",
      title: "Construction Manager",
      email: "theo.barnes@mesamodern.example",
      phone: "(480) 555-0107",
      cellPhone: "(480) 555-0121",
      isPrimary: true,
    },
  },
];

const JOBS = [
  {
    key: "greystone",
    clientKey: "harborline",
    title: "Greystone Residence - Full Stone Package",
    status: "open",
    streetAddress: "81 Granite Crest Drive",
    city: "Rancho Mirage",
    state: "CA",
    zipCode: "92270",
    contractPrice: "58749.88",
    jobType: "full_house_project",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    projectedStart: "2026-08-21",
    projectedCompletion: "2026-09-18",
    actualStart: "2026-08-21",
    actualCompletion: null,
    contractType: "fixed_price",
    internalNotes: "Primary showcase project. Taj Mahal quartzite package with digital vein-match approval and mitered island edges.",
    subVendorNotes: "Confirm all fixture models and cabinet readiness before field measure.",
    squareFeet: "182",
    permitNumber: "RM-26-1847",
    contractValueCents: 5874988,
    amountPaidCents: 2937494,
    assigneeRoles: ["projectManager", "crewMember", "drafter"],
  },
  {
    key: "blue-heron",
    clientKey: "juniper",
    title: "Blue Heron Residence - Primary Suite",
    status: "open",
    streetAddress: "19 Blue Heron Court",
    city: "Indian Wells",
    state: "CA",
    zipCode: "92210",
    contractPrice: "24750.00",
    jobType: "bathrooms",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    projectedStart: "2026-08-28",
    projectedCompletion: "2026-09-15",
    actualStart: null,
    actualCompletion: null,
    contractType: "fixed_price",
    internalNotes: "Calacatta Monet vanity, shower jambs, bench, and book-matched feature wall.",
    subVendorNotes: "Coordinate waterproofing inspection before jamb template.",
    squareFeet: "74",
    permitNumber: "IW-26-0931",
    contractValueCents: 2475000,
    amountPaidCents: 742500,
    assigneeRoles: ["projectManager", "crewMember", "drafter"],
  },
  {
    key: "el-paseo-hotel",
    clientKey: "northgate",
    title: "El Paseo House Hotel - Lobby & Bar",
    status: "open",
    streetAddress: "73-180 El Paseo",
    city: "Palm Desert",
    state: "CA",
    zipCode: "92260",
    contractPrice: "128400.00",
    jobType: "custom",
    workDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    projectedStart: "2026-09-08",
    projectedCompletion: "2026-10-23",
    actualStart: null,
    actualCompletion: null,
    contractType: "fixed_price",
    internalNotes: "Commercial lobby floors, reception desk, fireplace, and 42-foot lobby bar. Night installation planned for public areas.",
    subVendorNotes: "Submit rigging plan and after-hours access roster 72 hours before delivery.",
    squareFeet: "1260",
    permitNumber: "PD-26-4418-C",
    contractValueCents: 12840000,
    amountPaidCents: 3852000,
    assigneeRoles: ["projectManager", "crewMember", "drafter"],
  },
  {
    key: "casa-sol",
    clientKey: "sonoran",
    title: "Casa Sol Restaurant - Bar Expansion",
    status: "closed",
    streetAddress: "155 Mercado Lane",
    city: "Palm Springs",
    state: "CA",
    zipCode: "92262",
    contractPrice: "44750.00",
    jobType: "custom",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    projectedStart: "2026-06-15",
    projectedCompletion: "2026-07-10",
    actualStart: "2026-06-15",
    actualCompletion: "2026-07-09",
    contractType: "fixed_price",
    internalNotes: "Completed Verde Alpi bar top, service station, and restroom vanity package. Retained as reference project.",
    subVendorNotes: "Closeout complete; warranty walk scheduled for January 2027.",
    squareFeet: "196",
    permitNumber: "PS-26-1180-TI",
    contractValueCents: 4475000,
    amountPaidCents: 4475000,
    assigneeRoles: ["projectManager", "crewMember"],
  },
  {
    key: "whisper-rock",
    clientKey: "mesa-modern",
    title: "Whisper Rock Residence - Outdoor Kitchen",
    status: "open",
    streetAddress: "8621 East Desert Vista Trail",
    city: "Scottsdale",
    state: "AZ",
    zipCode: "85266",
    contractPrice: "31860.00",
    jobType: "kitchen_countertops",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    projectedStart: "2026-09-14",
    projectedCompletion: "2026-10-02",
    actualStart: null,
    actualCompletion: null,
    contractType: "fixed_price",
    internalNotes: "Leathered Negresco granite, grill surround, pizza counter, and raised bar. Exterior-grade adhesive and UV-stable seam system required.",
    subVendorNotes: "Verify appliance vents and steel support before template.",
    squareFeet: "112",
    permitNumber: "SC-26-7732",
    contractValueCents: 3186000,
    amountPaidCents: 955800,
    assigneeRoles: ["projectManager", "crewMember", "drafter"],
  },
];

const LEADS = [
  {
    title: "Silverleaf Estates Lot 18 - Whole Home Stone",
    streetAddress: "10342 East Desert Vista Drive",
    city: "Scottsdale",
    state: "AZ",
    zipCode: "85255",
    confidence: 80,
    projectedSalesDate: "2026-09-11",
    estimatedRevenueMin: "92000",
    estimatedRevenueMax: "118000",
    status: "in_negotiation",
    projectType: "Whole-home natural stone and porcelain package",
    notes: "Design team requested alternates for kitchen quartzite and primary-bath book match. Budget review scheduled after slab-yard visit.",
    leadSource: "Architect referral",
    tags: ["High value", "Residential", "Quartzite"],
    sources: ["Architect referral", "Repeat builder"],
  },
  {
    title: "High Desert Dental - Reception & Sterilization",
    streetAddress: "44-980 Monterey Avenue",
    city: "Palm Desert",
    state: "CA",
    zipCode: "92260",
    confidence: 60,
    projectedSalesDate: "2026-09-25",
    estimatedRevenueMin: "28000",
    estimatedRevenueMax: "36000",
    status: "qualified",
    projectType: "Commercial solid surface and porcelain fabrication",
    notes: "GC issued 90% drawings. Need infection-control-compatible seam and backsplash alternates.",
    leadSource: "General contractor bid invite",
    tags: ["Commercial", "Bid due"],
    sources: ["Bid invite"],
  },
  {
    title: "Canyon House - Kitchen & Fireplace Remodel",
    streetAddress: "670 Canyon View Road",
    city: "Palm Springs",
    state: "CA",
    zipCode: "92264",
    confidence: 40,
    projectedSalesDate: "2026-10-02",
    estimatedRevenueMin: "38000",
    estimatedRevenueMax: "52000",
    status: "open",
    projectType: "Kitchen countertops, full-height splash, and fireplace cladding",
    notes: "Homeowner is comparing Taj Mahal quartzite with porcelain. Awaiting cabinet elevations and appliance schedule.",
    leadSource: "Website inquiry",
    tags: ["Residential", "Needs design assist"],
    sources: ["Website"],
  },
  {
    title: "Sagebrush Country Club - Locker Room Renovation",
    streetAddress: "12 Clubhouse Loop",
    city: "La Quinta",
    state: "CA",
    zipCode: "92253",
    confidence: 70,
    projectedSalesDate: "2026-09-18",
    estimatedRevenueMin: "64000",
    estimatedRevenueMax: "79000",
    status: "qualified",
    projectType: "Large-format porcelain walls, vanities, and steam-room benches",
    notes: "Site walk complete. Phased work must maintain one operating locker room at all times.",
    leadSource: "Owner referral",
    tags: ["Commercial", "Phased work", "Porcelain"],
    sources: ["Owner referral"],
  },
];

const SCHEDULES = {
  greystone: [
    ["Digital field measure", "2026-08-21", 1, ["projectManager", "crewMember"], "Verify cabinets, fixtures, appliance specs, and all wall conditions.", ["Template", "Field"]],
    ["CAD layout and slab vein match", "2026-08-24", 3, ["drafter", "projectManager"], "Prepare revision set with island book match and full-height splash elevations.", ["CAD", "Approval"]],
    ["Client layout approval", "2026-08-27", 2, ["projectManager", "drafter"], "Collect signed layout approval before releasing CNC files.", ["Approval", "Hold point"]],
    ["CNC fabrication and edge build-up", "2026-09-01", 7, ["drafter", "crewMember"], "Machine approved pieces, fabricate mitered build-ups, and record QC photographs.", ["Fabrication"]],
    ["Shop dry fit and quality control", "2026-09-10", 2, ["projectManager", "crewMember"], "Dry-fit island seam, inspect finish, and stage pieces by delivery sequence.", ["QC", "Shop"]],
    ["Delivery and installation", "2026-09-18", 1, ["projectManager", "crewMember"], "Install kitchen, pantry, and wet bar package; complete client walk-through.", ["Install", "Client milestone"]],
  ],
  "blue-heron": [
    ["Shower waterproofing readiness walk", "2026-08-28", 1, ["projectManager", "crewMember"], "Confirm substrate tolerances, niche dimensions, and drain alignment.", ["Field", "Hold point"]],
    ["Vanity and jamb template", "2026-08-31", 1, ["crewMember", "projectManager"], "Capture vanity, bench, curb, and jamb dimensions.", ["Template"]],
    ["Book-match layout set", "2026-09-01", 3, ["drafter", "projectManager"], "Prepare primary wall book match and vanity backsplash detail.", ["CAD", "Approval"]],
    ["Primary suite installation", "2026-09-14", 2, ["crewMember", "projectManager"], "Install vanity and wet-area pieces; coordinate protection with tile contractor.", ["Install"]],
  ],
  "el-paseo-hotel": [
    ["Lobby control-line survey", "2026-09-08", 2, ["projectManager", "crewMember"], "Establish finished floor, bar, fireplace, and reception control lines.", ["Field", "Commercial"]],
    ["Reception desk fabrication release", "2026-09-14", 1, ["drafter", "projectManager"], "Release shop tickets after architect submittal approval.", ["Submittal", "Approval"]],
    ["Lobby floor mockup", "2026-09-21", 2, ["projectManager", "crewMember"], "Install full-size pattern mockup for architect and owner review.", ["Mockup", "Client milestone"]],
    ["Night-shift lobby installation phase 1", "2026-10-05", 6, ["projectManager", "crewMember"], "Install west lobby and reception zone during approved closure windows.", ["Install", "Night work"]],
  ],
};

const DAILY_LOGS = {
  greystone: [
    ["Field measure complete - cabinets verified", "2026-08-21", "Laser template completed for kitchen, pantry, and wet bar. Cabinets were level within tolerance. Island sink model and cooktop specification were verified against the approved fixture schedule. One outlet location was shifted 1 1/4 inches and marked for the CAD set.", ["Template", "Field verification"]],
    ["Slabs received and bundle matched", "2026-08-24", "Five Taj Mahal quartzite slabs from bundle TQ-2608 arrived without transit damage. Bundle tags and front-lit photographs were uploaded. Slabs 311A and 311B were reserved for the island book match.", ["Material", "Receiving", "QC"]],
    ["Layout revision 02 issued for approval", "2026-08-27", "Revised island seam position and wet-bar feature selection were issued to the builder and designer. Fabrication remains on hold until written approval is received.", ["CAD", "Approval", "Hold point"]],
  ],
  "casa-sol": [
    ["Final bar installation and turnover", "2026-07-09", "Bar top, service station, and restroom vanities were installed. Seams, cutouts, and final polish passed the superintendent walk. Care and maintenance packet was delivered; no open punch items remained.", ["Install", "Closeout", "Client sign-off"]],
  ],
  "el-paseo-hotel": [
    ["Preconstruction coordination meeting", "2026-08-18", "Reviewed lobby phasing, night access, freight elevator clearances, dust control, and mockup requirements with Northgate. Rigging plan and after-hours crew roster are due before delivery.", ["Coordination", "Safety", "Commercial"]],
  ],
};

const FINANCIAL_LINES = [
  ["Material Procurement", "Taj Mahal quartzite - premium bundle TQ-2608", 5, 395000, 1975000],
  ["Field & Design", "Digital field measure and laser templating", 1, 185000, 185000],
  ["Field & Design", "CAD layout, vein match, and approval set", 1, 225000, 225000],
  ["Fabrication", "CNC fabrication and shop finishing", 182, 9500, 1729000],
  ["Fabrication", "2.5 inch mitered build-up edge", 86, 7800, 670800],
  ["Fabrication", "Sink, cooktop, faucet, and outlet cutouts", 5, 28500, 142500],
  ["Installation", "Delivery, installation, seam set, and final polish", 1, 765000, 765000],
  ["Taxes & Fees", "California sales tax on material", 1, 182688, 182688],
];

const PDF_UPLOADS = [
  ["01_project_estimate_SR-EST-24037.pdf", "Estimates & Contracts", "Client estimate and payment schedule"],
  ["02_slab_layout_approval_SR-LA-24037-02.pdf", "Drawings & Approvals", "Digital vein-match layout approval revision 02"],
  ["03_purchase_order_SR-PO-10482.pdf", "Material & Purchasing", "Taj Mahal quartzite purchase order"],
  ["04_installation_work_order_SR-WO-24037-04.pdf", "Field & Installation", "Installation field packet and QC checklist"],
  ["05_change_order_SR-CO-24037-01.pdf", "Estimates & Contracts", "Waterfall leg change order pending approval"],
];

class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function makePassword() {
  return `Sp!${randomBytes(18).toString("base64url")}9aA`;
}

function writePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function generateCredentials() {
  if (existsSync(CREDENTIALS_PATH)) {
    console.log(`Credentials already exist at ${CREDENTIALS_PATH}`);
    return;
  }
  const credentials = {
    organizationName: DEMO_ORGANIZATION_NAME,
    generatedAt: new Date().toISOString(),
    accounts: Object.fromEntries(
      Object.entries(ACCOUNTS).map(([key, account]) => [
        key,
        { ...account, password: makePassword() },
      ]),
    ),
  };
  writePrivateJson(CREDENTIALS_PATH, credentials);
  console.log(`Generated private credentials at ${CREDENTIALS_PATH}`);
}

function readCredentials() {
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(`Missing ${CREDENTIALS_PATH}. Run --generate-credentials first.`);
  }
  const stored = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  return {
    ...stored,
    organizationName: DEMO_ORGANIZATION_NAME,
    accounts: Object.fromEntries(
      Object.entries(ACCOUNTS).map(([key, account]) => [
        key,
        { ...stored.accounts[key], ...account },
      ]),
    ),
  };
}

function readState() {
  if (!existsSync(STATE_PATH)) {
    return { version: 1, accounts: {}, clients: {}, jobs: {}, uploads: {} };
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  writePrivateJson(STATE_PATH, state);
}

function requireExecuteFlag() {
  if (!process.argv.includes("--execute")) {
    throw new Error("Production writes require the explicit --execute flag.");
  }
}

async function api(path, { method = "GET", token, body, form, expectedStatus } = {}) {
  const headers = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method)) headers["Idempotency-Key"] = randomUUID();

  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers,
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    redirect: "follow",
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  const accepted = expectedStatus
    ? (Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]).includes(response.status)
    : response.ok;
  if (!accepted) {
    const detail = data?.detail || data?.message || data?.title || text || response.statusText;
    throw new ApiError(response.status, `${method} ${path} failed (${response.status}): ${detail}`, data);
  }
  return data;
}

async function login(account) {
  return api("/api/auth/login", {
    method: "POST",
    body: { email: account.email, password: account.password },
  });
}

async function tryLogin(account) {
  try {
    return await login(account);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

async function rotateLogins() {
  requireExecuteFlag();
  const stored = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  const state = readState();

  for (const [key, account] of Object.entries(stored.accounts)) {
    const nextEmail = account.nextEmail;
    const nextPassword = account.nextPassword;
    if (!nextEmail && !nextPassword) continue;

    const session = await login(account);
    if (nextEmail && nextEmail !== account.email) {
      await api("/api/users/me", {
        method: "PUT",
        token: session.accessToken,
        body: { email: nextEmail, currentPassword: account.password },
      });
      account.email = nextEmail;
      delete account.nextEmail;
      if (state.accounts[key]) state.accounts[key].email = nextEmail;
      writePrivateJson(CREDENTIALS_PATH, stored);
      saveState(state);
    }

    if (nextPassword && nextPassword !== account.password) {
      await api("/api/users/me/password", {
        method: "POST",
        token: session.accessToken,
        body: { currentPassword: account.password, newPassword: nextPassword },
      });
      account.password = nextPassword;
      delete account.nextPassword;
      writePrivateJson(CREDENTIALS_PATH, stored);
    }

    console.log(`Rotated login: ${account.email}`);
  }
}

async function registerOwner() {
  requireExecuteFlag();
  const credentials = readCredentials();
  const admin = credentials.accounts.admin;
  const existingSession = await tryLogin(admin);
  if (existingSession) {
    console.log(`Owner already active: ${admin.email}`);
    return existingSession;
  }
  const session = await api("/api/auth/register", {
    method: "POST",
    body: {
      email: admin.email,
      password: admin.password,
      full_name: admin.fullName,
      organization_name: credentials.organizationName,
      accepted_terms_version: LEGAL_VERSION,
      accepted_privacy_version: LEGAL_VERSION,
    },
  });
  const state = readState();
  state.accounts.admin = { id: session.user.id, email: admin.email, role: "admin" };
  saveState(state);
  console.log(`Created owner ${admin.email} (${session.user.id}). Activate the demo tenant before running --populate.`);
  return session;
}

async function ensureRoleAccounts(adminToken, credentials, state) {
  const list = await api("/api/users?limit=100&includeInactive=true", { token: adminToken });
  const users = list.users || list.data || [];
  const sessions = {};

  for (const [key, account] of Object.entries(credentials.accounts)) {
    if (key === "admin") {
      sessions[key] = await login(account);
      if (sessions[key].user.fullName !== account.fullName) {
        const updated = await api(`/api/users/${sessions[key].user.id}`, {
          method: "PATCH",
          token: adminToken,
          body: { fullName: account.fullName },
        });
        sessions[key].user = updated.user;
      }
      state.accounts[key] = { id: sessions[key].user.id, email: account.email, role: "admin" };
      continue;
    }

    const activeSession = await tryLogin(account);
    if (activeSession) {
      if (activeSession.user.fullName !== account.fullName) {
        const updated = await api(`/api/users/${activeSession.user.id}`, {
          method: "PATCH",
          token: adminToken,
          body: { fullName: account.fullName },
        });
        activeSession.user = updated.user;
      }
      sessions[key] = activeSession;
      state.accounts[key] = { id: activeSession.user.id, email: account.email, role: account.role };
      continue;
    }

    let user = users.find((candidate) => candidate.email.toLowerCase() === account.email.toLowerCase());
    let invite;
    if (!user) {
      invite = await api("/api/users", {
        method: "POST",
        token: adminToken,
        body: { email: account.email, fullName: account.fullName, role: account.role },
      });
      user = invite.user;
    } else {
      invite = await api(`/api/users/${user.id}/invite`, {
        method: "POST",
        token: adminToken,
        body: {},
      });
    }

    sessions[key] = await api("/api/auth/accept-invite", {
      method: "POST",
      body: {
        token: invite.inviteToken,
        email: account.email,
        password: account.password,
        accepted_terms_version: LEGAL_VERSION,
        accepted_privacy_version: LEGAL_VERSION,
      },
    });
    state.accounts[key] = { id: sessions[key].user.id, email: account.email, role: account.role };
    saveState(state);
    console.log(`Ready: ${account.fullName} (${account.role})`);
  }

  return sessions;
}

async function ensureClients(token, state) {
  const listed = await api("/api/clients?pageSize=100&status=all", { token });
  const clients = listed.clients || [];

  for (const spec of CLIENTS) {
    const companyName = `${TEST_PREFIX}${spec.companyName}`;
    let client = clients.find(
      (candidate) => candidate.companyName === companyName || candidate.companyName === spec.companyName,
    );
    if (!client) {
      const { key, contact, ...payload } = spec;
      const created = await api("/api/clients", {
        method: "POST",
        token,
        body: { ...payload, companyName },
      });
      client = created.client;
      clients.push(client);
      console.log(`Created client: ${companyName}`);
    } else if (client.companyName !== companyName) {
      const { key, contact, ...payload } = spec;
      const updated = await api(`/api/clients/${client.id}`, {
        method: "PUT",
        token,
        body: { ...payload, companyName },
      });
      client = updated.client;
      console.log(`Marked client as TEST: ${companyName}`);
    }
    state.clients[spec.key] = client.id;

    const contacts = await api(`/api/clients/${client.id}/contacts`, { token });
    const desiredContact = {
      ...spec.contact,
      firstName: `TEST ${spec.contact.firstName}`,
    };
    const existingContact = (contacts.contacts || []).find(
      (candidate) => candidate.email?.toLowerCase() === spec.contact.email.toLowerCase(),
    );
    if (!existingContact) {
      await api(`/api/clients/${client.id}/contacts`, {
        method: "POST",
        token,
        body: desiredContact,
      });
    } else if (existingContact.firstName !== desiredContact.firstName) {
      await api(`/api/clients/${client.id}/contacts/${existingContact.id}`, {
        method: "PUT",
        token,
        body: desiredContact,
      });
    }
    saveState(state);
  }
}

async function ensureJobs(token, state) {
  const listed = await api("/api/jobs?pageSize=100", { token });
  const jobs = listed.jobs || [];

  for (const spec of JOBS) {
    const title = `${TEST_PREFIX}${spec.title}`;
    let job = jobs.find((candidate) => candidate.title === title || candidate.title === spec.title);
    if (!job) {
      const { key, clientKey, assigneeRoles, ...payload } = spec;
      const assigneeIds = assigneeRoles.map((role) => state.accounts[role].id);
      const created = await api("/api/jobs", {
        method: "POST",
        token,
        body: {
          ...payload,
          title,
          clientId: state.clients[clientKey],
          projectManagerId: state.accounts.projectManager.id,
          assigneeIds,
        },
      });
      job = created.job;
      jobs.push(job);
      console.log(`Created job: ${title}`);
    } else if (job.title !== title) {
      const { key, clientKey, assigneeRoles, ...payload } = spec;
      const updated = await api(`/api/jobs/${job.id}`, {
        method: "PUT",
        token,
        body: {
          ...payload,
          title,
          clientId: state.clients[clientKey],
          projectManagerId: state.accounts.projectManager.id,
        },
      });
      job = updated.job;
      console.log(`Marked job as TEST: ${title}`);
    }
    state.jobs[spec.key] = job.id;
    saveState(state);
  }
}

async function ensureLeads(token, state) {
  const listed = await api("/api/leads?pageSize=100", { token });
  const leads = listed.leads || [];
  state.leads ||= {};
  for (const spec of LEADS) {
    const title = `${TEST_PREFIX}${spec.title}`;
    let lead = leads.find((candidate) => candidate.title === title || candidate.title === spec.title);
    if (!lead) {
      lead = await api("/api/leads", {
        method: "POST",
        token,
        body: {
          ...spec,
          title,
          salespeople: [state.accounts.admin.id, state.accounts.projectManager.id],
        },
      });
      leads.push(lead);
      console.log(`Created lead: ${title}`);
    } else if (lead.title !== title) {
      lead = await api(`/api/leads/${lead.id}`, {
        method: "PUT",
        token,
        body: {
          ...spec,
          title,
          salespeople: [state.accounts.admin.id, state.accounts.projectManager.id],
        },
      });
      console.log(`Marked lead as TEST: ${title}`);
    }
    state.leads[title] = lead.id;
  }
  saveState(state);
}

async function ensureSchedules(token, state) {
  state.scheduleItems ||= {};
  const colors = ["#0E6B67", "#C89A3D", "#3E6F8E", "#6D597A", "#2F855A", "#B45309"];

  for (const [jobKey, specs] of Object.entries(SCHEDULES)) {
    const jobId = state.jobs[jobKey];
    const listed = await api(`/api/jobs/${jobId}/schedule?limit=100`, { token });
    const byTitle = new Map((listed.data || []).map((item) => [item.title, item]));
    let predecessorId = null;
    state.scheduleItems[jobKey] ||= {};

    for (const [index, [title, startDate, workDays, roleKeys, notes, tags]] of specs.entries()) {
      const testTitle = `${TEST_PREFIX}${title}`;
      let item = byTitle.get(testTitle) || byTitle.get(title);
      if (!item) {
        const created = await api(`/api/jobs/${jobId}/schedule`, {
          method: "POST",
          token,
          body: {
            title: testTitle,
            startDate,
            workDays,
            displayColor: colors[index % colors.length],
            assigneeIds: roleKeys.map((key) => state.accounts[key].id),
            notifyUserIds: [],
            notes,
            tags,
            progress: startDate < "2026-08-19" ? 100 : 0,
            isComplete: startDate < "2026-08-19",
            predecessors: predecessorId
              ? [{ scheduleItemId: predecessorId, dependencyType: "finish_to_start", lagDays: 0 }]
              : [],
          },
        });
        item = created.item;
        byTitle.set(testTitle, item);
      }
      predecessorId = item.id;
      state.scheduleItems[jobKey][testTitle] = item.id;
    }
    saveState(state);
  }
}

async function ensureDailyLogs(token, state) {
  state.dailyLogs ||= {};
  for (const [jobKey, specs] of Object.entries(DAILY_LOGS)) {
    const jobId = state.jobs[jobKey];
    const listed = await api(`/api/jobs/${jobId}/daily-logs?pageSize=100`, { token });
    const logs = listed.logs || [];
    state.dailyLogs[jobKey] ||= {};
    for (const [title, logDate, notes, tags] of specs) {
      const testTitle = `${TEST_PREFIX}${title}`;
      let log = logs.find((candidate) => candidate.title === testTitle || candidate.title === title);
      if (!log) {
        const created = await api(`/api/jobs/${jobId}/daily-logs`, {
          method: "POST",
          token,
          body: {
            logDate,
            title: testTitle,
            notes,
            includeWeather: false,
            includeWeatherNotes: false,
            shareInternalUsers: true,
            shareSubsVendors: false,
            shareClient: false,
            isPrivate: false,
            notifyUserIds: [],
            tags,
          },
        });
        log = created.log;
        logs.push(log);
      }
      state.dailyLogs[jobKey][testTitle] = log.id;
    }
    saveState(state);
  }
}

async function ensureFinancials(token, state) {
  const jobId = state.jobs.greystone;
  let financials = await api(`/api/jobs/${jobId}/financials`, { token });
  await api(`/api/jobs/${jobId}/financials`, {
    method: "PATCH",
    token,
    body: { projectName: "Greystone Residence", contractDate: "2026-08-18", currency: "USD" },
  });

  const areaNames = [...new Set(FINANCIAL_LINES.map(([name]) => name)), "Approved Changes"];
  const areas = new Map((financials.areas || []).map((area) => [area.name, area]));
  for (const [sortOrder, name] of areaNames.entries()) {
    if (!areas.has(name)) {
      const created = await api(`/api/jobs/${jobId}/financials/areas`, {
        method: "POST",
        token,
        body: { name, sortOrder, isChangeOrderGroup: name === "Approved Changes" },
      });
      areas.set(name, { ...created.area, lineItems: [] });
    }
  }

  financials = await api(`/api/jobs/${jobId}/financials`, { token });
  const existingDescriptions = new Set(
    (financials.areas || []).flatMap((area) => (area.lineItems || []).map((item) => item.description)),
  );
  for (const [sortOrder, [areaName, description, qty, rateCents, scheduledValueCents]] of FINANCIAL_LINES.entries()) {
    if (existingDescriptions.has(description)) continue;
    await api(`/api/jobs/${jobId}/financials/line-items`, {
      method: "POST",
      token,
      body: {
        areaId: areas.get(areaName).id,
        description,
        qty,
        rateCents,
        scheduledValueCents,
        sortOrder,
      },
    });
  }

  financials = await api(`/api/jobs/${jobId}/financials`, { token });
  if (!(financials.changeOrders || []).some((change) => change.number === "SR-CO-24037-01")) {
    await api(`/api/jobs/${jobId}/financials/change-orders`, {
      method: "POST",
      token,
      body: {
        number: "SR-CO-24037-01",
        description: "Add island waterfall leg and revise seam geometry after cabinet change.",
        amountCents: 428000,
        status: "pending",
        areaId: areas.get("Approved Changes").id,
      },
    });
  }
  state.financialsReady = true;
  saveState(state);
}

async function ensurePdfUploads(token, state) {
  const jobId = state.jobs.greystone;
  for (const [filename, folderPath, note] of PDF_UPLOADS) {
    const path = resolve(PDF_DIR, filename);
    if (!existsSync(path)) throw new Error(`Missing demo PDF: ${path}`);
    if (state.uploads[filename]) continue;
    const form = new FormData();
    form.append("mediaType", "document");
    form.append("folderPath", folderPath);
    form.append("createIfMissing", "true");
    form.append("duplicateAction", "skip_exact");
    form.append("note", note);
    form.append("files", new Blob([readFileSync(path)], { type: "application/pdf" }), filename);
    const uploaded = await api(`/api/jobs/${jobId}/files/by-path`, {
      method: "POST",
      token,
      form,
    });
    const file = uploaded.files?.[0] || uploaded.createdFiles?.[0] || uploaded.file || null;
    state.uploads[filename] = file?.id || "uploaded";
    saveState(state);
    console.log(`Uploaded PDF: ${filename}`);
  }
}

async function provision() {
  requireExecuteFlag();
  const credentials = readCredentials();
  const state = readState();
  const adminSession = await login(credentials.accounts.admin);

  let sessions;
  try {
    sessions = await ensureRoleAccounts(adminSession.accessToken, credentials, state);
  } catch (error) {
    if (error instanceof ApiError && error.status === 402) {
      throw new Error("The demo organization is still subscription-locked. Run the activation SQL, then retry --populate.");
    }
    throw error;
  }

  await ensureClients(adminSession.accessToken, state);
  await ensureJobs(adminSession.accessToken, state);
  await ensureLeads(adminSession.accessToken, state);
  await ensureSchedules(adminSession.accessToken, state);
  await ensureDailyLogs(adminSession.accessToken, state);
  await ensureFinancials(adminSession.accessToken, state);
  await ensurePdfUploads(adminSession.accessToken, state);
  console.log(`Provisioned ${credentials.organizationName} at ${ORIGIN}.`);
  return { credentials, state, sessions };
}

async function expectStatus(path, token, status) {
  try {
    await api(path, { token, expectedStatus: status });
  } catch (error) {
    throw new Error(`Role check failed for ${path}: ${error.message}`);
  }
}

async function verify() {
  const credentials = readCredentials();
  const state = readState();
  const sessions = {};
  for (const [key, account] of Object.entries(credentials.accounts)) {
    sessions[key] = await login(account);
    const me = await api("/api/users/me", { token: sessions[key].accessToken });
    if (me.user.role !== account.role) {
      throw new Error(`${account.email} has role ${me.user.role}, expected ${account.role}.`);
    }
  }

  await expectStatus("/api/users?limit=10", sessions.admin.accessToken, 200);
  await expectStatus("/api/clients?pageSize=10", sessions.projectManager.accessToken, 200);
  await expectStatus("/api/jobs?pageSize=100", sessions.crewMember.accessToken, 200);
  await expectStatus("/api/leads?pageSize=10", sessions.drafter.accessToken, 200);
  await expectStatus("/api/clients?pageSize=10", sessions.crewMember.accessToken, 403);
  await expectStatus(`/api/jobs/${state.jobs.greystone}/financials`, sessions.crewMember.accessToken, 403);
  await expectStatus(`/api/jobs/${state.jobs.greystone}/financials`, sessions.drafter.accessToken, 403);

  const adminJobs = await api("/api/jobs?pageSize=100", { token: sessions.admin.accessToken });
  const adminClients = await api("/api/clients?pageSize=100&status=all", { token: sessions.admin.accessToken });
  const adminLeads = await api("/api/leads?pageSize=100", { token: sessions.admin.accessToken });
  const crewJobs = await api("/api/jobs?pageSize=100", { token: sessions.crewMember.accessToken });
  if ((adminJobs.jobs || []).length < JOBS.length) throw new Error("Expected demo jobs are missing.");
  if ((adminClients.clients || []).length < CLIENTS.length) throw new Error("Expected demo clients are missing.");
  if ((adminLeads.leads || []).length < LEADS.length) throw new Error("Expected demo leads are missing.");
  if ((crewJobs.jobs || []).length < 1) throw new Error("Crew member has no assigned demo jobs.");
  console.log("All four accounts, role gates, and core demo collections verified.");
}

function printActivationSql() {
  const email = readCredentials().accounts.admin.email.replaceAll("'", "''");
  console.log(`UPDATE organizations AS o
SET requires_subscription = false,
    status = 'active',
    plan_key = 'demo',
    subscription_status = 'trialing',
    trial_ends_at = NOW() + INTERVAL '1 year',
    updated_at = NOW()
FROM users AS u
WHERE u.default_organization_id = o.id
  AND LOWER(u.email) = LOWER('${email}');`);
}

async function main() {
  const command = process.argv.find((argument) => argument.startsWith("--") && argument !== "--execute");
  switch (command) {
    case "--generate-credentials":
      generateCredentials();
      break;
    case "--activation-sql":
      printActivationSql();
      break;
    case "--register-owner":
      await registerOwner();
      break;
    case "--populate":
      await provision();
      break;
    case "--verify":
      await verify();
      break;
    case "--rotate-logins":
      await rotateLogins();
      break;
    default:
      console.error("Usage: provision_demo_tenant.mjs --generate-credentials | --activation-sql | --register-owner --execute | --populate --execute | --rotate-logins --execute | --verify");
      process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
