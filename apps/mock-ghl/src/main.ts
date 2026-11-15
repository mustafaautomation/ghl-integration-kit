import { startMock } from './server.js';

const port = Number(process.env.PORT ?? 4100);
const { url } = await startMock({
  port,
  host: process.env.HOST ?? '0.0.0.0',
  clientId: process.env.GHL_CLIENT_ID ?? 'mock-client-id',
  clientSecret: process.env.GHL_CLIENT_SECRET ?? 'mock-client-secret',
  locationId: process.env.LOCATION_ID ?? 'loc_northwind_555',
  companyId: process.env.COMPANY_ID ?? 'co_northwind_555',
  userId: process.env.USER_ID ?? 'user_555',
  locationName: process.env.BUSINESS_NAME ?? 'Northwind Studio',
});
console.log(JSON.stringify({ mock: url }));
