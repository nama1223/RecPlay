export interface OrgInfo {
  id: string
  name: string
}

const LS_KEY = 'recplay_orgs'

export function getStoredOrgs(): OrgInfo[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function storeOrg(org: OrgInfo): void {
  const orgs = getStoredOrgs()
  if (!orgs.find((o) => o.id === org.id)) {
    localStorage.setItem(LS_KEY, JSON.stringify([...orgs, org]))
  }
}
