import { InstitutionListing } from './link.provider.interface';

export interface StubInstitution extends InstitutionListing {
  monogram: string;
}

export const STUB_INSTITUTIONS: StubInstitution[] = [
  { id: 'ins_chase_stub',    name: 'Chase',              color: '#117ACA', monogram: 'CH', accountTypes: ['checking', 'savings', 'credit'] },
  { id: 'ins_bofa_stub',     name: 'Bank of America',    color: '#E31837', monogram: 'BA', accountTypes: ['checking', 'savings', 'credit'] },
  { id: 'ins_wf_stub',       name: 'Wells Fargo',        color: '#D71E28', monogram: 'WF', accountTypes: ['checking', 'savings'] },
  { id: 'ins_citi_stub',     name: 'Citi',               color: '#003B70', monogram: 'CI', accountTypes: ['checking', 'savings', 'credit'] },
  { id: 'ins_capone_stub',   name: 'Capital One',        color: '#D03027', monogram: 'C1', accountTypes: ['checking', 'savings', 'credit'] },
  { id: 'ins_usbank_stub',   name: 'US Bank',            color: '#0C2074', monogram: 'US', accountTypes: ['checking', 'savings'] },
  { id: 'ins_pnc_stub',      name: 'PNC',                color: '#F58025', monogram: 'PN', accountTypes: ['checking', 'savings'] },
  { id: 'ins_td_stub',       name: 'TD Bank',            color: '#54B848', monogram: 'TD', accountTypes: ['checking', 'savings'] },
  { id: 'ins_truist_stub',   name: 'Truist',             color: '#492E81', monogram: 'TR', accountTypes: ['checking', 'savings'] },
  { id: 'ins_ally_stub',     name: 'Ally',               color: '#6E2585', monogram: 'AL', accountTypes: ['checking', 'savings'] },
  { id: 'ins_discover_stub', name: 'Discover',           color: '#FF6000', monogram: 'DI', accountTypes: ['savings', 'credit'] },
  { id: 'ins_schwab_stub',   name: 'Charles Schwab',     color: '#00A0DF', monogram: 'SC', accountTypes: ['checking', 'brokerage'] },
  { id: 'ins_fidelity_stub', name: 'Fidelity',           color: '#368727', monogram: 'FI', accountTypes: ['checking', 'brokerage'] },
  { id: 'ins_sofi_stub',     name: 'SoFi',               color: '#00A1DF', monogram: 'SF', accountTypes: ['checking', 'savings'] },
  { id: 'ins_amex_stub',     name: 'American Express',   color: '#016FD0', monogram: 'AX', accountTypes: ['savings', 'credit'] },
  { id: 'ins_hsbc_stub',     name: 'HSBC',               color: '#DB0011', monogram: 'HS', accountTypes: ['checking', 'savings'] },
  { id: 'ins_marcus_stub',   name: 'Goldman / Marcus',   color: '#7399C6', monogram: 'MA', accountTypes: ['savings'] },
  { id: 'ins_navyfcu_stub',  name: 'Navy Federal',       color: '#003366', monogram: 'NF', accountTypes: ['checking', 'savings'] },
  { id: 'ins_usaa_stub',     name: 'USAA',               color: '#003366', monogram: 'UA', accountTypes: ['checking', 'savings'] },
  { id: 'ins_firstrep_stub', name: 'First Republic',     color: '#103E68', monogram: 'FR', accountTypes: ['checking', 'savings'] },
];

export const REAUTH_PRONE_INSTITUTIONS = new Set(['ins_chase_stub', 'ins_wf_stub']);

export function searchInstitutions(q?: string): StubInstitution[] {
  if (!q) return STUB_INSTITUTIONS;
  const needle = q.trim().toLowerCase();
  if (!needle) return STUB_INSTITUTIONS;
  return STUB_INSTITUTIONS.filter(
    (i) => i.name.toLowerCase().includes(needle) || i.id.toLowerCase().includes(needle),
  );
}

export function findInstitution(id: string): StubInstitution | undefined {
  return STUB_INSTITUTIONS.find((i) => i.id === id);
}
