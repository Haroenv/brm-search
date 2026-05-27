import { dateToNum } from '../date';
import { Brevet } from '../types';
import { checkOk } from './fetch-utils';

type Raw = {
  contact: { email: string; name: string };
  distance: number;
  entryFee: number;
  from: {
    Country: 'NL';
    address: string;
    city: string;
    region: string;
    title: string;
  };
  start: `2025-01-25T09:00:00Z[UTC]`;
  title: string;
  url: string;
};

async function fetchBrevets(): Promise<Raw[]> {
  const now = new Date();
  const until = new Date(now);
  until.setFullYear(until.getFullYear() + 1);

  const url = new URL('https://randonneurs.nl/api/v1/events');
  url.search = new URLSearchParams({
    from: now.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0],
  }).toString();

  const events: Raw[] = await fetch(url)
    .then(checkOk)
    .then((res) => res.json());

  return events;
}

function cleanBrevets(brevets: Raw[]): Brevet[] {
  return brevets.map((brevet) => {
    const date = brevet.start.split('T')[0].split('-').reverse().join('/');
    const dateNumber = dateToNum(new Date(brevet.start.split('T')[0]));
    const distance = brevet.distance;
    const country = 'The Netherlands';
    const city = brevet.from.city;
    const title = brevet.title;
    const mail = brevet.contact.email;
    const club = 'Randonneurs NL';

    return {
      objectID: [date, distance, country, city].join('__'),
      date,
      dateNumber,
      name: title,
      distance,
      country,
      city,
      site: brevet.url,
      mail,
      club,
      time: 0,
      ascent: 0,
      meta: brevet,
    };
  });
}

export async function getData() {
  console.log('Fetching Netherlands brevets...');
  return cleanBrevets(await fetchBrevets());
}
