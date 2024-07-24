import { Brevet } from '../types';

const { SUPABASE = '' } = process.env;
if (!SUPABASE) {
  throw new Error('Missing SUPABASE env variable');
}

type Raw = {
  id: number;
  created_at: string;
  city: string;
  latitude: number;
  longitude: number;
  distance: number;
  date: string;
  codeClub: string;
  nomorganisateur: string;
  mailorganisateur: string;
  maplink: string;
  clubwebsite: string;
  idorga: number;
  denivele: string;
  country: string;
  status: string;
  nom: string;
  nomClub: string;
};

async function fetchBrevets(): Promise<Raw[]> {
  const apikey = SUPABASE;
  const brevets = await fetch(
    'https://svbtqggtspnhpbfbgswf.supabase.co/rest/v1/brevets?select=%2A',
    {
      headers: {
        apikey,
        Authorization: 'Bearer ' + apikey,
      },
      method: 'GET',
      referrer: 'https://map.audax-club-parisien.com/',
    }
  ).then((res) => res.json());

  if (!Array.isArray(brevets)) throw new Error('Invalid response');

  return brevets;
}

function cleanBrevets(brevets: Raw[]): Brevet[] {
  return brevets.map((brevet) => ({
    objectID: 'supabase__' + brevet.id.toString(),
    date: brevet.date,
    dateNumber: parseInt(brevet.date.split('/').reverse().join(''), 10),
    distance: brevet.distance,
    country: brevet.country,
    region: brevet.nom,
    department: brevet.city,
    city: brevet.city,
    _geoloc: [{ lat: brevet.latitude, lng: brevet.longitude }],
    map: [brevet.maplink].filter(Boolean),
    site: brevet.clubwebsite,
    mail: brevet.mailorganisateur,
    club: brevet.nomClub,
    ascent: parseInt(brevet.denivele, 10),
    time: new Date(brevet.date.split('/').reverse().join('-')).getTime() / 1000,
    status: brevet.status,
    meta: brevet,
  }));
}

export async function getData() {
  return cleanBrevets(await fetchBrevets());
}
