export const WORKER_URL = 'https://bgdisplay-worker.zanebaize.workers.dev';
export const UI_VERSION = '2.0.0';

export const PUMP_CATALOG = [
  { brand: 'No pump', models: [{ model: 'No pump', type: 'none', modes: ['No automation'] }] },
  {
    brand: 'Tandem Diabetes Care',
    models: [
      { model: 't:slim X2', type: 'pump', modes: ['Control-IQ', 'Basal-IQ', 'Manual Mode'] },
      { model: 't:slim Mobi', type: 'pump', modes: ['Control-IQ', 'Manual Mode'] },
    ],
  },
  {
    brand: 'Insulet (Omnipod)',
    models: [
      { model: 'Omnipod 5', type: 'patch-pump', modes: ['Automated Mode', 'Manual Mode'] },
      { model: 'Omnipod DASH', type: 'patch-pump', modes: ['Manual Mode'] },
      { model: 'Omnipod Eros', type: 'patch-pump', modes: ['Manual Mode'] },
    ],
  },
  {
    brand: 'Medtronic',
    models: [
      { model: 'MiniMed 780G', type: 'pump', modes: ['SmartGuard', 'Manual Mode'] },
      { model: 'MiniMed 770G', type: 'pump', modes: ['Auto Mode', 'Manual Mode'] },
      { model: 'MiniMed 670G', type: 'pump', modes: ['Auto Mode', 'Manual Mode'] },
    ],
  },
  {
    brand: 'Beta Bionics',
    models: [{ model: 'iLet Bionic Pancreas', type: 'pump', modes: ['Bionic Mode'] }],
  },
  {
    brand: 'Ypsomed',
    models: [
      { model: 'mylife YpsoPump', type: 'pump', modes: ['CamAPS FX Auto Mode', 'Manual Mode'] },
    ],
  },
  {
    brand: 'Roche',
    models: [{ model: 'Accu-Chek Solo', type: 'patch-pump', modes: ['Manual Mode'] }],
  },
  {
    brand: 'Other',
    models: [
      { model: 'Other', type: 'pump', modes: ['Manual Mode', 'Hybrid Closed Loop', 'Closed Loop'] },
    ],
  },
];
