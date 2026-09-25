#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  JOBS,
  LEADS,
  SCHEDULES,
  readCredentials,
  readState,
  saveState,
} from "./provision_demo_tenant.mjs";

const root = resolve(import.meta.dirname, "../..");
const origin = process.env.SLABPLAN_DEMO_ORIGIN;
if (!origin || new URL(origin).protocol !== "https:")
  throw new Error("Set SLABPLAN_DEMO_ORIGIN to the authorized HTTPS app.");
const command = process.argv[2];
const execute = process.argv.includes("--execute");
const demoDate =
  process.env.SLABPLAN_DEMO_DATE || new Date().toISOString().slice(0, 10);
const credentials = readCredentials();
const state = readState();
const sessions = {};
const timings = [];
const resultPath = resolve(root, "tmp/demo-refresh-result.json");
const result = existsSync(resultPath)
  ? JSON.parse(readFileSync(resultPath))
  : { date: demoDate, jobs: {}, logs: {}, uploads: {}, checks: [] };
const prefix = "TEST - ";
function day(offset) {
  const d = new Date(`${demoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function save() {
  saveState(state);
  writeFileSync(
    resolve(root, "tmp/demo-refresh-result.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
}
async function request(
  path,
  {
    role = "admin",
    method = "GET",
    body,
    form,
    expected = 200,
    anonymous = false,
  } = {},
) {
  if (method !== "GET" && !anonymous && !execute)
    throw new Error("Writes require --execute");
  const start = performance.now();
  const response = await fetch(origin + path, {
    method,
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(!anonymous
        ? { Authorization: `Bearer ${sessions[role].accessToken}` }
        : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "Idempotency-Key": randomUUID() } : {}),
    },
    body: form || (body ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(90000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  timings.push({
    path,
    role,
    status: response.status,
    ms: Math.round(performance.now() - start),
  });
  if (![expected].flat().includes(response.status))
    throw new Error(
      `${method} ${path}: ${response.status} ${JSON.stringify(data).slice(0, 900)}`,
    );
  return data;
}
async function authenticate() {
  for (const [key, account] of Object.entries(credentials.accounts)) {
    let session = await request("/api/auth/login", {
      anonymous: true,
      method: "POST",
      body: { email: account.email, password: account.password },
      expected: [200, 401],
    });
    if (
      !session.accessToken &&
      key === "projectManager" &&
      command === "--refresh" &&
      execute
    ) {
      const stored = JSON.parse(
        readFileSync(resolve(root, "tmp/slabplan-demo-credentials.json")),
      );
      const old = stored.accounts.projectManager;
      session = await request("/api/auth/login", {
        anonymous: true,
        method: "POST",
        body: { email: old.email, password: old.password },
      });
      sessions[key] = session;
      if (
        session.user.id !== state.accounts.projectManager.id ||
        session.user.defaultOrganizationId !==
          sessions.admin.user.defaultOrganizationId
      )
        throw new Error("PM identity mismatch");
      await request("/api/users/me", {
        role: key,
        method: "PUT",
        body: { email: account.email, currentPassword: account.password },
      });
      stored.accounts.projectManager.email = account.email;
      writeFileSync(
        resolve(root, "tmp/slabplan-demo-credentials.json"),
        JSON.stringify(stored, null, 2),
        { mode: 0o600 },
      );
      session = await request("/api/auth/login", {
        anonymous: true,
        method: "POST",
        body: { email: account.email, password: account.password },
      });
      console.log(`Demo PM login updated to ${account.email}`);
    }
    if (
      !session.accessToken ||
      session.user.role !== account.role ||
      !session.user.fullName.startsWith("TEST")
    )
      throw new Error(`Unexpected demo identity for ${account.email}`);
    sessions[key] = session;
    if (
      session.user.defaultOrganizationId !==
      sessions.admin.user.defaultOrganizationId
    )
      throw new Error("Demo accounts must share one organization");
    if (state.accounts[key].id !== session.user.id)
      throw new Error("Saved demo account mismatch");
    state.accounts[key].email = account.email;
  }
  console.log("All four demo identities and shared organization verified.");
}

const extraJobs = [
  {
    key: "atlas-showroom",
    clientKey: "northgate",
    title: "Atlas Design Showroom - Reception & Display",
    status: "open",
    streetAddress: "420 Design Center Way",
    city: "Palm Desert",
    state: "CA",
    zipCode: "92260",
    contractPrice: "36800.00",
    contractValueCents: 3680000,
    amountPaidCents: 0,
    jobType: "custom",
    contractType: "fixed_price",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    projectedStart: day(3),
    projectedCompletion: day(21),
    actualStart: null,
    actualCompletion: null,
    internalNotes:
      "Fictional demo. Newly awarded showroom: honed Arabescato reception, porcelain display plinths, and sample wall. Architect approval required before shop release.",
    subVendorNotes:
      "Confirm electrical rough-in at reception. Coordinate with millwork installer.",
    squareFeet: "210",
    permitNumber: "DEMO-PD-260925",
    assigneeRoles: ["projectManager", "drafter"],
  },
  {
    key: "saguaro-villa",
    clientKey: "mesa-modern",
    title: "Saguaro Villa - Kitchen & Guest Casita",
    status: "open",
    streetAddress: "440 Saguaro Ridge Lane",
    city: "Scottsdale",
    state: "AZ",
    zipCode: "85255",
    contractPrice: "72650.00",
    contractValueCents: 7265000,
    amountPaidCents: 0,
    jobType: "full_house_project",
    contractType: "fixed_price",
    workDays: ["mon", "tue", "wed", "thu", "fri"],
    projectedStart: day(5),
    projectedCompletion: day(28),
    actualStart: null,
    actualCompletion: null,
    internalNotes:
      "Fictional demo. New contract: Cristallo quartzite island, perimeter counters, guest casita vanity, and outdoor service counter. Two material alternates awaiting owner selection.",
    subVendorNotes:
      "Check access for 124-inch island slab. Final field measurements follow cabinet sign-off.",
    squareFeet: "286",
    permitNumber: "DEMO-SC-260925",
    assigneeRoles: ["projectManager", "crewMember", "drafter"],
  },
];
const dates = {
  greystone: [-24, 3, -24, null],
  "blue-heron": [-9, 6, -9, null],
  "el-paseo-hotel": [-17, 21, -17, null],
  "casa-sol": [-65, -49, -65, -49],
  "whisper-rock": [3, 14, null, null],
};
async function refreshJobs() {
  const all = (await request("/api/jobs?pageSize=100")).jobs;
  for (const spec of [...JOBS, ...extraJobs]) {
    let job = all.find((j) => j.title === prefix + spec.title);
    if (!job && !extraJobs.includes(spec))
      throw new Error(`Expected demo job missing: ${spec.title}`);
    const { key, clientKey, assigneeRoles, ...fields } = spec;
    const d = dates[key];
    const payload = {
      ...fields,
      title: prefix + spec.title,
      clientId: state.clients[clientKey],
      projectManagerId: state.accounts.projectManager.id,
      ...(d
        ? {
            projectedStart: day(d[0]),
            projectedCompletion: day(d[1]),
            actualStart: d[2] === null ? null : day(d[2]),
            actualCompletion: d[3] === null ? null : day(d[3]),
          }
        : {}),
    };
    if (!job)
      job = (
        await request("/api/jobs", {
          method: "POST",
          expected: 201,
          body: {
            ...payload,
            assigneeIds: assigneeRoles.map((k) => state.accounts[k].id),
          },
        })
      ).job;
    else
      job = (
        await request(`/api/jobs/${job.id}`, { method: "PUT", body: payload })
      ).job;
    state.jobs[key] = job.id;
    result.jobs[key] = { id: job.id, title: job.title };
    save();
  }
  const main = state.jobs.greystone;
  await request(
    `/api/jobs/${main}/assignees/${state.accounts.projectManager.id}/financials-access`,
    { method: "PATCH", body: { canViewFinancials: true } },
  );
  console.log(`Refreshed ${Object.keys(result.jobs).length} demo projects.`);
}

// Every task belongs to a guarded TEST job. Offsets keep the demo current.
const schedulePlan = {
  greystone: [
    [
      "Digital field measure",
      -24,
      1,
      100,
      ["projectManager", "crewMember"],
      "Survey & Design",
    ],
    [
      "CAD layout and slab vein match",
      -23,
      3,
      100,
      ["drafter", "projectManager"],
      "Survey & Design",
    ],
    [
      "Client layout approval",
      -20,
      2,
      100,
      ["projectManager", "drafter"],
      "Survey & Design",
    ],
    [
      "CNC fabrication and edge build-up",
      -15,
      7,
      100,
      ["drafter", "crewMember"],
      "Fabrication & QC",
    ],
    [
      "Shop dry fit and quality control",
      -3,
      2,
      100,
      ["projectManager", "crewMember"],
      "Fabrication & QC",
    ],
    [
      "Delivery and installation",
      0,
      1,
      60,
      ["crewMember", "projectManager"],
      "Installation & Closeout",
    ],
    [
      "Punch walk and care-kit handover",
      3,
      1,
      0,
      ["crewMember", "projectManager"],
      "Installation & Closeout",
    ],
    [
      "Record as-built seam plan",
      3,
      1,
      0,
      ["drafter"],
      "Installation & Closeout",
    ],
  ],
  "blue-heron": [
    [
      "Shower waterproofing readiness walk",
      -9,
      1,
      100,
      ["projectManager", "crewMember"],
      "Survey & Design",
    ],
    [
      "Vanity and jamb template",
      -7,
      1,
      100,
      ["crewMember", "projectManager"],
      "Survey & Design",
    ],
    [
      "Book-match layout set",
      -1,
      3,
      50,
      ["drafter", "projectManager"],
      "Survey & Design",
    ],
    [
      "Primary suite installation",
      5,
      2,
      0,
      ["crewMember", "projectManager"],
      "Installation & Closeout",
    ],
  ],
  "el-paseo-hotel": [
    [
      "Lobby control-line survey",
      -17,
      2,
      100,
      ["projectManager", "crewMember"],
      "Survey & Design",
    ],
    [
      "Reception desk fabrication release",
      -7,
      1,
      100,
      ["drafter", "projectManager"],
      "Fabrication & QC",
    ],
    [
      "Lobby floor mockup",
      -3,
      2,
      100,
      ["projectManager", "crewMember"],
      "Fabrication & QC",
    ],
    [
      "Night-shift lobby installation phase 1",
      3,
      6,
      0,
      ["projectManager", "crewMember"],
      "Installation & Closeout",
    ],
  ],
  "whisper-rock": [
    [
      "Appliance and steel support readiness",
      3,
      1,
      0,
      ["crewMember", "projectManager"],
      "Survey & Design",
    ],
    ["Outdoor kitchen CAD release", 4, 2, 0, ["drafter"], "Survey & Design"],
    [
      "Negresco cutting and exterior edge finish",
      7,
      3,
      0,
      ["drafter", "crewMember"],
      "Fabrication & QC",
    ],
    [
      "Outdoor kitchen installation",
      12,
      2,
      0,
      ["crewMember"],
      "Installation & Closeout",
    ],
  ],
  "atlas-showroom": [
    [
      "Architect material selection review",
      3,
      1,
      0,
      ["projectManager", "drafter"],
      "Survey & Design",
    ],
    [
      "Reception shop drawing revision A",
      4,
      3,
      0,
      ["drafter"],
      "Survey & Design",
    ],
    [
      "Porcelain display fabrication",
      10,
      4,
      0,
      ["drafter", "projectManager"],
      "Fabrication & QC",
    ],
  ],
  "saguaro-villa": [
    [
      "Cabinet and fixture coordination",
      5,
      1,
      0,
      ["projectManager"],
      "Survey & Design",
    ],
    ["Villa laser template", 6, 1, 0, ["crewMember"], "Survey & Design"],
    [
      "Cristallo vein-match presentation",
      7,
      3,
      0,
      ["drafter"],
      "Survey & Design",
    ],
  ],
  "casa-sol": [
    [
      "Final bar installation and turnover",
      -49,
      1,
      100,
      ["crewMember", "projectManager"],
      "Installation & Closeout",
    ],
  ],
};
async function refreshSchedules() {
  const colors = {
    "Survey & Design": "#2563eb",
    "Fabrication & QC": "#0f766e",
    "Installation & Closeout": "#ea580c",
  };
  for (const [key, rows] of Object.entries(schedulePlan)) {
    const id = state.jobs[key];
    const existing = (await request(`/api/jobs/${id}/schedule?limit=100`)).data;
    const phases = (await request(`/api/jobs/${id}/schedule/phases`)).phases;
    for (const name of new Set(rows.map((r) => r[5])))
      if (!phases.some((p) => p.name === name))
        phases.push(
          (
            await request(`/api/jobs/${id}/schedule/phases`, {
              method: "POST",
              expected: 201,
              body: { name, color: colors[name] },
            })
          ).phase,
        );
    let predecessor = null;
    state.scheduleItems[key] ||= {};
    for (const [title, offset, workDays, progress, roles, phase] of rows) {
      const current = existing.find(
        (t) => t.title.replace(/^TEST - /, "") === title,
      );
      const original = SCHEDULES[key]?.find((r) => r[0] === title);
      const payload = {
        title: prefix + title,
        startDate: day(offset),
        workDays,
        progress,
        isComplete: progress === 100,
        phaseId: phases.find((p) => p.name === phase).id,
        displayColor: colors[phase],
        assigneeIds: roles.map((r) => state.accounts[r].id),
        notifyUserIds: [],
        notes:
          original?.[4] ||
          `${title}. Review the project packet and log completion with photos. Fictional demo work.`,
        tags: original?.[5] || [phase.split(" & ")[0]],
        predecessors: predecessor
          ? [
              {
                scheduleItemId: predecessor,
                dependencyType: "finish_to_start",
                lagDays: 0,
              },
            ]
          : [],
      };
      const response = await request(
        current
          ? `/api/schedule-items/${current.id}`
          : `/api/jobs/${id}/schedule`,
        {
          method: current ? "PATCH" : "POST",
          expected: current ? 200 : 201,
          body: payload,
        },
      );
      predecessor = response.item.id;
      state.scheduleItems[key][title] = predecessor;
      save();
    }
    console.log(`Schedule ready: ${key}`);
  }
}

const financialPlans = {
  "blue-heron": [
    [
      "Stone & Materials",
      "Calacatta Monet slabs and book-match selection",
      950000,
      50,
    ],
    [
      "Field & Design",
      "Laser template and primary-suite shop drawings",
      275000,
      100,
    ],
    [
      "Fabrication",
      "Vanity, bench, jamb and wall-panel fabrication",
      825000,
      25,
    ],
    ["Installation", "Primary-suite installation and sealing", 425000, 0],
  ],
  "el-paseo-hotel": [
    [
      "Material Procurement",
      "Lobby limestone flooring and stone reception bundle",
      5120000,
      80,
    ],
    [
      "Field & Design",
      "Control-line survey, shop drawings and mockups",
      1240000,
      100,
    ],
    [
      "Fabrication",
      "Lobby bar, fireplace and reception fabrication",
      3480000,
      50,
    ],
    [
      "Installation",
      "Night-shift installation, protection and turnover",
      3000000,
      10,
    ],
  ],
  "whisper-rock": [
    ["Stone & Materials", "Leathered Negresco granite bundle", 1350000, 30],
    [
      "Field & Design",
      "Outdoor template and appliance coordination",
      285000,
      0,
    ],
    ["Fabrication", "Grill surround, raised bar and pizza counter", 951000, 0],
    [
      "Installation",
      "Exterior installation and UV-stable seam finish",
      600000,
      0,
    ],
  ],
  "casa-sol": [
    [
      "Stone & Materials",
      "Verde Alpi bar and service station stone",
      1925000,
      100,
    ],
    [
      "Fabrication",
      "Bar top, service station and vanity fabrication",
      1550000,
      100,
    ],
    [
      "Installation",
      "Restaurant installation, polish and closeout",
      1000000,
      100,
    ],
  ],
  "atlas-showroom": [
    [
      "Stone & Materials",
      "Arabescato reception and porcelain display materials",
      1680000,
      0,
    ],
    ["Field & Design", "Architect coordination and shop drawings", 420000, 0],
    ["Fabrication", "Reception desk and display plinth fabrication", 980000, 0],
    ["Installation", "Showroom installation and handover", 600000, 0],
  ],
  "saguaro-villa": [
    [
      "Stone & Materials",
      "Cristallo quartzite and casita stone package",
      3420000,
      20,
    ],
    ["Field & Design", "Template, CAD and vein-match approvals", 645000, 0],
    [
      "Fabrication",
      "Kitchen, casita and outdoor counter fabrication",
      2100000,
      0,
    ],
    ["Installation", "Villa installation and final protection", 1100000, 0],
  ],
};
async function refreshFinancials() {
  for (const key of Object.keys(state.jobs)) {
    const jobId = state.jobs[key];
    if (!schedulePlan[key]) continue;
    let f = await request(`/api/jobs/${jobId}/financials`);
    await request(`/api/jobs/${jobId}/financials`, {
      method: "PATCH",
      body: {
        projectName: result.jobs[key]?.title || prefix + key,
        contractDate: extraJobs.some((j) => j.key === key)
          ? demoDate
          : day(-28),
        currency: "USD",
      },
    });
    for (const [areaName, description, cents, pct] of financialPlans[key] ||
      []) {
      let area = f.areas.find((a) => a.name === areaName);
      if (!area) {
        area = (
          await request(`/api/jobs/${jobId}/financials/areas`, {
            method: "POST",
            expected: 201,
            body: { name: areaName, sortOrder: f.areas.length },
          })
        ).area;
        area.lineItems = [];
        f.areas.push(area);
      }
      let item = area.lineItems.find((l) => l.description === description);
      if (!item)
        item = (
          await request(`/api/jobs/${jobId}/financials/line-items`, {
            method: "POST",
            expected: 201,
            body: {
              areaId: area.id,
              description,
              qty: 1,
              rateCents: cents,
              scheduledValueCents: cents,
              sortOrder: area.lineItems.length,
            },
          })
        ).lineItem;
      await request(`/api/jobs/${jobId}/financials/line-items/${item.id}`, {
        method: "PATCH",
        body: { percentComplete: pct },
      });
    }
    if (key === "greystone") {
      for (const area of f.areas)
        for (const item of area.lineItems)
          await request(`/api/jobs/${jobId}/financials/line-items/${item.id}`, {
            method: "PATCH",
            body: { percentComplete: area.name === "Installation" ? 50 : 100 },
          });
      if (!f.changeOrders.some((c) => c.number === "TEST-SR-CO-24037-02"))
        await request(`/api/jobs/${jobId}/financials/change-orders`, {
          method: "POST",
          expected: 201,
          body: {
            number: "TEST-SR-CO-24037-02",
            description:
              "Fictional approved change: add pantry full-height backsplash, 24 sq ft. Approved in demo on " +
              day(-4) +
              ".",
            amountCents: 216000,
            status: "approved",
            areaId: f.areas.find((a) => a.isChangeOrderGroup)?.id,
          },
        });
    }
    console.log(`Financial tracker ready: ${key}`);
  }
}

const logPlan = [
  [
    "greystone",
    "crewMember",
    0,
    "Island set and seams finished - installation 60%",
    "Crew: Marcus Lee plus two installers. On site 07:00-11:30, 13.5 total labor hours. Island pieces G-01/G-02 dry fitted and set; seam aligned within the approved vein-match layout. Perimeter tops installed and sink clips checked. Floor protection intact. Remaining: wet bar splash, final sealing and client punch walk. No incidents. Photos are synthetic demo documentation.",
    ["Installation", "QC", "Today"],
  ],
  [
    "greystone",
    "drafter",
    -1,
    "Revision 03 released - pantry splash detail",
    "Issued G-101 revision 03 and updated piece register. Island seam remains at 72 inches from west end. Pantry backsplash addition is approved under TEST-SR-CO-24037-02; waterfall change SR-CO-24037-01 remains pending and is NOT released to fabrication. CNC export checked against field template.",
    ["CAD", "Revision", "Approved"],
  ],
  [
    "greystone",
    "projectManager",
    -2,
    "Pre-install readiness and delivery coordination",
    "Builder confirmed cabinets anchored and level, appliances on site, water isolated and access path clear. Five slab pieces staged by installation sequence. Delivery window 06:30-07:00 Friday; installer has field packet. Owner punch walk booked Monday 09:00. Written approval required for pending waterfall alternate.",
    ["Coordination", "Delivery"],
  ],
  [
    "blue-heron",
    "drafter",
    0,
    "Primary-suite book-match review - revision A",
    "Vanity and wall elevations 50% complete. Left and right feature panels mirror at centerline; bench grain continues across front edge. Open RFI: confirm wall sconce centers before outlet cutouts. Designer review due Monday at 10:00. Jamb dimensions verified against waterproofing clearance.",
    ["CAD", "RFI", "Approval"],
  ],
  [
    "blue-heron",
    "crewMember",
    -2,
    "Template verified - vanity and shower jambs",
    "Laser template captured for 84-inch double vanity, curb, bench and jamb returns. Substrate flatness within 1/8 inch over 10 feet. Plumber confirmed faucet centerlines. Protected finished tile; no material left on site. Next visit follows drawing approval.",
    ["Template", "Field"],
  ],
  [
    "el-paseo-hotel",
    "projectManager",
    -1,
    "Lobby mockup approved - night access confirmed",
    "Architect accepted limestone running-bond mockup and reception edge sample. West lobby closure approved 20:00-05:00 starting Monday. Freight route and A-frame staging area marked. Follow-up: receive written access roster and dust-control sign-off.",
    ["Commercial", "Mockup", "Safety"],
  ],
  [
    "whisper-rock",
    "projectManager",
    0,
    "Outdoor readiness - support verification pending",
    "Appliance cut sheets received for 36-inch grill and 24-inch refrigerator. Steel cantilever support inspection scheduled Monday before template. Exterior adhesive and UV-stable seam sample recorded. Do not release granite cutting until support spacing is accepted.",
    ["Readiness", "Hold point"],
  ],
  [
    "atlas-showroom",
    "projectManager",
    0,
    "Kickoff - new showroom contract awarded",
    "Purchase order received for the fictional $36,800 reception and display package. Architect is reviewing two Arabescato options. Internal kickoff complete; Priya owns shop drawing revision A. Material selection meeting booked for Monday.",
    ["New contract", "Kickoff"],
  ],
  [
    "saguaro-villa",
    "projectManager",
    0,
    "Villa scope handoff - field measure booked",
    "New fictional $72,650 stone package. Builder accepted scope and sent cabinet elevations. PM assigned template and drafting tasks; slab-yard viewing next Wednesday. Confirm island access before reserving Cristallo bundle.",
    ["New contract", "Handoff"],
  ],
  [
    "casa-sol",
    "crewMember",
    -49,
    "Closeout accepted - care packet delivered",
    "Completed all bar and restroom stonework. Superintendent checked seams, polish and fixture clearances. No open punch items. Care packet handed over and warranty record filed. Fictional closeout used to demonstrate a completed project.",
    ["Closeout", "Quality"],
  ],
];
async function refreshLogs() {
  for (const [key, role, offset, title, notes, tags] of logPlan) {
    const jobId = state.jobs[key];
    const full = prefix + title;
    const logs = (
      await request(`/api/jobs/${jobId}/daily-logs?pageSize=100`, { role })
    ).logs;
    let log = logs.find((l) => l.title === full);
    if (!log)
      log = (
        await request(`/api/jobs/${jobId}/daily-logs`, {
          role,
          method: "POST",
          expected: 201,
          body: {
            logDate: day(offset),
            title: full,
            notes,
            tags,
            includeWeather: false,
            includeWeatherNotes: false,
            shareInternalUsers: true,
            shareSubsVendors: false,
            shareClient: false,
            isPrivate: false,
            notifyUserIds: [],
          },
        })
      ).log;
    if (!log.publishedAt)
      await request(`/api/daily-logs/${log.id}/publish`, {
        role,
        method: "POST",
        body: { notifyUserIds: [] },
      });
    result.logs[title] = { id: log.id, jobKey: key, role };
    save();
  }
  const install = result.logs[logPlan[0][3]].id;
  const detail = await request(`/api/daily-logs/${install}`);
  const comments = detail.comments || [];
  for (const [role, body] of [
    [
      "projectManager",
      "TEST - Thanks Marcus. Builder confirmed the Monday 09:00 punch walk. Please attach the seam close-up and leave the island protected overnight.",
    ],
    [
      "drafter",
      "TEST - Field seam matches revision 03. Please measure the pantry splash outlet offset before final cutting.",
    ],
  ])
    if (!comments.some((c) => c.body === body))
      await request(`/api/daily-logs/${install}/comments`, {
        role,
        method: "POST",
        expected: 201,
        body: { body, mentions: [], attachments: [], links: [] },
      });
  for (const title of [
    "TEST - Upload final seam and edge QC photos",
    "TEST - Confirm Monday punch walk with builder",
    "TEST - Deliver stone care kit at handover",
  ])
    if (!(detail.todos || []).some((t) => t.title === title))
      await request(`/api/daily-logs/${install}/todos`, {
        role: "crewMember",
        method: "POST",
        expected: 201,
        body: { title },
      });
  console.log(
    "Current field logs, drafting updates, comments and follow-up checklist ready.",
  );
}
async function refreshLeads() {
  const listed = (await request("/api/leads?pageSize=100")).leads;
  for (const [index, spec] of LEADS.entries()) {
    const lead = listed.find((l) => l.title === prefix + spec.title);
    if (!lead) throw new Error("Missing expected demo lead");
    await request(`/api/leads/${lead.id}`, {
      method: "PUT",
      body: {
        ...spec,
        title: prefix + spec.title,
        projectedSalesDate: day([7, 14, 21, 10][index]),
        salespeople: [
          state.accounts.admin.id,
          state.accounts.projectManager.id,
        ],
      },
    });
  }
}
async function guardJobs() {
  for (const [key, id] of Object.entries(state.jobs)) {
    const job = (await request(`/api/jobs/${id}`)).job;
    if (!job.title.startsWith(prefix))
      throw new Error(`Refusing non-test job ${key}`);
    result.jobs[key] = { id, title: job.title };
  }
}
const documentUploads = [
  [
    "greystone",
    "TEST-Greystone-Installation-Packet.pdf",
    "Field & Installation",
  ],
  ["greystone", "TEST-Greystone-CAD-G101-Rev03.pdf", "Drawings & Approvals"],
  ["greystone", "TEST-Greystone-Progress-Invoice.pdf", "Estimates & Contracts"],
  ["blue-heron", "TEST-Blue-Heron-Bookmatch-RevA.pdf", "Drawings & Approvals"],
  [
    "el-paseo-hotel",
    "TEST-Hotel-Submittal-and-Phasing.pdf",
    "Submittals & Coordination",
  ],
  [
    "whisper-rock",
    "TEST-Whisper-Rock-Template-Checklist.pdf",
    "Field & Installation",
  ],
  [
    "atlas-showroom",
    "TEST-Atlas-Showroom-Estimate.pdf",
    "Estimates & Contracts",
  ],
  ["casa-sol", "TEST-Stone-Care-and-Handover.pdf", "Closeout & Warranty"],
  ["saguaro-villa", "TEST-Stone-Care-and-Handover.pdf", "Client Handover"],
];
async function uploadAssets() {
  state.demoSeptember ||= { uploads: {} };
  for (const [key, name, folder] of [
    ...documentUploads,
    ["greystone", "TEST-greystone-installation.png", "Installation Progress"],
  ]) {
    const mediaType = name.endsWith(".png") ? "photo" : "document";
    const path = resolve(
      root,
      "output/demo-september",
      mediaType === "photo" ? "assets" : "documents",
      name,
    );
    const form = new FormData();
    form.append("mediaType", mediaType);
    form.append("folderPath", folder);
    form.append("createIfMissing", "true");
    form.append("duplicateAction", "skip_exact");
    form.append(
      "note",
      "TEST - fictional demo content for the shared Summit Ridge Stoneworks company.",
    );
    form.append(
      "files",
      new Blob([readFileSync(path)], {
        type: mediaType === "photo" ? "image/png" : "application/pdf",
      }),
      name,
    );
    const uploaded = await request(
      `/api/jobs/${state.jobs[key]}/files/by-path`,
      { method: "POST", form, expected: 201 },
    );
    state.demoSeptember.uploads[`${key}/${name}`] = uploaded;
    save();
    console.log(`Private upload ready: ${key}/${name}`);
  }
  const install =
    result.logs["Island set and seams finished - installation 60%"];
  if (install) {
    const detail = await request(`/api/daily-logs/${install.id}`);
    if (
      !(detail.attachments || []).some(
        (a) => (a.originalName || a.name) === "TEST-greystone-installation.png",
      )
    ) {
      const form = new FormData();
      form.append(
        "files",
        new Blob(
          [
            readFileSync(
              resolve(
                root,
                "output/demo-september/assets/TEST-greystone-installation.png",
              ),
            ),
          ],
          { type: "image/png" },
        ),
        "TEST-greystone-installation.png",
      );
      await request(`/api/daily-logs/${install.id}/attachments`, {
        method: "POST",
        role: "crewMember",
        form,
        expected: 201,
      });
    }
  }
  const foldersResult = await request("/api/resources/folders");
  const folders = foldersResult.folders || foldersResult.data || [];
  let folder = folders.find(
    (f) => f.title === "TEST - Stone Care & Field Standards",
  );
  if (!folder)
    folder = (
      await request("/api/resources/folders", {
        method: "POST",
        body: { title: "TEST - Stone Care & Field Standards" },
        expected: 201,
      })
    ).folder;
  const files = await request(`/api/resources/folders/${folder.id}/files`);
  const name = "TEST-Stone-Care-and-Handover.pdf";
  if (!(files.files || files.data || []).some((f) => f.originalName === name)) {
    const form = new FormData();
    form.append(
      "files",
      new Blob(
        [readFileSync(resolve(root, "output/demo-september/documents", name))],
        { type: "application/pdf" },
      ),
      name,
    );
    await request(`/api/resources/folders/${folder.id}/upload`, {
      method: "POST",
      form,
      expected: 201,
    });
  }
  state.demoSeptember.resourceFolder = folder.id;
  save();
}
async function importInvoice() {
  const id = state.jobs.greystone;
  const before = await request(`/api/jobs/${id}/financials`);
  let invoice = before.invoices.find(
    (i) => i.invoiceNumber === "TEST-SR-INV-24037-02",
  );
  const items = before.areas
    .flatMap((a) => a.lineItems)
    .filter((i) => !i.isChangeOrder && !i.isRemoved);
  for (const item of items)
    await request(`/api/jobs/${id}/financials/line-items/${item.id}`, {
      method: "PATCH",
      body: { percentComplete: 0 },
    });
  try {
    if (!invoice) {
      const form = new FormData();
      form.append(
        "file",
        new Blob(
          [
            readFileSync(
              resolve(
                root,
                "output/demo-september/documents/TEST-Greystone-Progress-Invoice.pdf",
              ),
            ),
          ],
          { type: "application/pdf" },
        ),
        "TEST-Greystone-Progress-Invoice.pdf",
      );
      const response = await request(`/api/jobs/${id}/financials/invoices`, {
        method: "POST",
        form,
        expected: 201,
      });
      const latest = await request(`/api/jobs/${id}/financials`);
      invoice = latest.invoices.find((i) => i.id === response.invoiceId);
    }
    if (!invoice || Number(invoice.totalCents) !== 2937494)
      throw new Error("Invoice parsing did not match the expected demo total");
    await request(`/api/jobs/${id}/financials/invoices/${invoice.id}/matches`, {
      method: "PATCH",
      body: {
        matches: items.map((i) => ({
          sovLineItemId: i.id,
          amountCents: Math.round(i.scheduledValueCents / 2),
        })),
      },
    });
    state.demoSeptember ||= { uploads: {} };
    state.demoSeptember.invoiceId = invoice.id;
    save();
    console.log(
      "Real invoice parsing and exact SOV allocation verified: $29,374.94.",
    );
  } catch (error) {
    for (const item of items)
      await request(`/api/jobs/${id}/financials/line-items/${item.id}`, {
        method: "PATCH",
        body: { percentComplete: Number(item.percentComplete) },
      });
    throw error;
  }
}
async function enrichHandoffs() {
  const handoffs = [
    {
      job: "greystone",
      task: "Delivery and installation",
      role: "crewMember",
      file: "TEST-Greystone-Installation-Packet.pdf",
      note: "TEST - Island set and seam QC complete. Wet-bar splash and sealing remain. PM has confirmed Monday's punch walk.",
      todos: [
        "TEST - Photograph seam and edge quality",
        "TEST - Measure pantry outlet offset",
        "TEST - Prepare care kit for Monday handover",
      ],
    },
    {
      job: "blue-heron",
      task: "Book-match layout set",
      role: "drafter",
      file: "TEST-Blue-Heron-Bookmatch-RevA.pdf",
      note: "TEST - Revision A is ready for designer markup. RFI-07 sconce centers must be confirmed before electrical cutouts are released.",
      todos: [
        "TEST - Confirm RFI-07 sconce centerlines",
        "TEST - Issue approved book-match revision B",
      ],
    },
    {
      job: "greystone",
      task: "Record as-built seam plan",
      role: "drafter",
      file: "TEST-Greystone-CAD-G101-Rev03.pdf",
      note: "TEST - Use revision 03 and the installer's field measurements to issue the final as-built seam record.",
      todos: ["TEST - Add pantry outlet offset to as-built drawing"],
    },
  ];
  for (const handoff of handoffs) {
    const id = state.scheduleItems[handoff.job]?.[handoff.task];
    if (!id) throw new Error(`Refresh schedules before adding ${handoff.task}`);
    const { item } = await request(`/api/schedule-items/${id}`, {
      role: handoff.role,
    });
    if (
      item.jobId !== state.jobs[handoff.job] ||
      !item.title.startsWith(prefix)
    )
      throw new Error("TEST task ownership mismatch");
    for (const title of handoff.todos) {
      if (!item.relatedTodos.some((todo) => todo.title === title)) {
        await request(`/api/schedule-items/${id}/todos`, {
          role: handoff.role,
          method: "POST",
          expected: 201,
          body: { title },
        });
      }
    }
    if (!item.notesStream.some((note) => note.note === handoff.note)) {
      await request(`/api/schedule-items/${id}/notes`, {
        role: handoff.role,
        method: "POST",
        expected: 201,
        body: { note: handoff.note },
      });
    }
    if (!item.attachments.some((file) => file.originalName === handoff.file)) {
      const form = new FormData();
      form.append(
        "files",
        new Blob(
          [
            readFileSync(
              resolve(root, "output/demo-september/documents", handoff.file),
            ),
          ],
          { type: "application/pdf" },
        ),
        handoff.file,
      );
      await request(`/api/schedule-items/${id}/attachments`, {
        role: handoff.role,
        method: "POST",
        expected: 201,
        form,
      });
    }
    console.log(`Task handoff ready: ${handoff.task}`);
  }
  const financials = await request(
    `/api/jobs/${state.jobs.greystone}/financials`,
  );
  const pending = financials.changeOrders.find(
    (co) => co.number === "SR-CO-24037-01",
  );
  if (pending)
    await request(
      `/api/jobs/${state.jobs.greystone}/financials/change-orders/${pending.id}`,
      {
        method: "PATCH",
        body: {
          description:
            "TEST - Add a second island waterfall leg and revise seam geometry after cabinet change. Pending approval; excluded from fabrication release.",
        },
      },
    );
}

async function verify() {
  result.checks = [];
  for (const [role, session] of Object.entries(sessions)) {
    const jobs = (await request("/api/jobs?pageSize=100", { role })).jobs;
    if (jobs.length < 4) throw new Error(`${role} has too few demo jobs`);
    const home = await request("/api/dashboard/home", { role });
    if (
      role === "drafter" &&
      home.recentLeads.some((lead) => !lead.title.startsWith(prefix))
    ) {
      throw new Error(
        "Drafter home includes a lead outside the guarded TEST dataset",
      );
    }
    if (
      role === "crewMember" &&
      home.today === demoDate &&
      home.schedule.items.length === 0
    ) {
      throw new Error("Installer home is missing the current demo assignment");
    }
    await request(`/api/jobs/${state.jobs.greystone}/schedule?limit=100`, {
      role,
    });
    await request(`/api/jobs/${state.jobs.greystone}/daily-logs?pageSize=100`, {
      role,
    });
    await request(
      `/api/jobs/${state.jobs.greystone}/folder-tree?mediaType=all`,
      { role },
    );
    await request(`/api/jobs/${state.jobs.greystone}/financials`, {
      role,
      expected: ["crewMember", "drafter"].includes(role) ? 403 : 200,
    });
    if (role === "crewMember")
      await request("/api/clients?pageSize=10", { role, expected: 403 });
    result.checks.push({
      role,
      email: session.user.email,
      jobCount: jobs.length,
      homeRole: home.role,
      homeScheduleCount: home.schedule?.items.length ?? home.week?.items.length,
      passed: true,
    });
  }
  for (const path of [
    "/api/healthz",
    "/api/reports/ar-aging",
    "/api/reports/revenue",
    "/api/reports/pipeline",
    "/api/reports/jobs-by-stage",
    "/api/daily-logs/feed?pageSize=25",
    "/api/resources/folders?mediaType=document",
  ])
    await request(path);
  console.log(
    JSON.stringify(
      {
        checks: result.checks,
        slowRequests: timings.filter((t) => t.ms > 2000),
      },
      null,
      2,
    ),
  );
  save();
}
await authenticate();
await guardJobs();
if (command === "--refresh") {
  await refreshJobs();
  await refreshSchedules();
  await refreshFinancials();
  await refreshLogs();
  await refreshLeads();
  save();
} else if (command === "--content") {
  await refreshFinancials();
  await refreshLogs();
  await refreshLeads();
  save();
} else if (command === "--schedules") {
  await refreshSchedules();
  save();
} else if (command === "--upload") await uploadAssets();
else if (command === "--invoice") await importInvoice();
else if (command === "--handoffs") await enrichHandoffs();
else if (command === "--verify") await verify();
else throw new Error("Use --refresh --execute or --verify");
