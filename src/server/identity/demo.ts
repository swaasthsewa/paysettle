/**
 * F1.1, F2.02, F1.4 · fixed demo data for the registration screens (sandbox). The seed (scripts/seed-reg.ts) creates
 * an open invite from the demo client to DEMO_INVITE_EMAIL, so "Continue with demo identity provider" with that address
 * shows invite linking end to end; and a self-registered provider whose licences carry OCR suggestions for Ops.
 */
export const DEMO_INVITE_EMAIL = "studio.new@invite.demo";
export const DEMO_INVITE_NAME = "Noah Brennan";
export const DEMO_INVITE_TITLE = "Brand refresh and booking site";
export const DEMO_REG_PROVIDER = { id: "u_reg_sana", orgId: "org_reg_sana", email: "sana@studio.demo", name: "Sana Mirza" } as const;
