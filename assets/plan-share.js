const DISTRICT_GROUPS = ["all", "11", "41", "26", "27", "30"];
const BANDS = ["59", "74", "84"];

function publicPlanSettings(searchParams) {
  const complex = searchParams.get("complex");
  const band = searchParams.get("band");
  const size = searchParams.get("size");
  const region = searchParams.get("region");
  const area = searchParams.get("area");
  const range = searchParams.get("range");
  return {
    complex: /^[a-z0-9][a-z0-9-]{0,63}$/.test(complex ?? "") ? complex : null,
    band: [...BANDS, "other"].includes(band) ? band : null,
    size: /^\d+(?:\.\d{1,8})?$/.test(size ?? "") && Number(size) > 0 && Number(size) < 10000 ? String(Number(size)) : null,
    region: DISTRICT_GROUPS.includes(region) ? region : null,
    area: [...BANDS, "all"].includes(area) ? area : null,
    range: ["near", "all"].includes(range) ? range : null
  };
}

export function readPlanShare(address) {
  return publicPlanSettings(new URL(address).searchParams);
}

export function planShareURL(address, settings) {
  const current = new URL(address);
  const link = new URL(current.origin);
  link.pathname = current.pathname;
  const publicSettings = publicPlanSettings(new URLSearchParams(settings));
  for (const [key, value] of Object.entries(publicSettings)) {
    if (value != null) link.searchParams.set(key, value);
  }
  link.hash = publicSettings.complex ? "calculator" : "budget";
  return link.href;
}
