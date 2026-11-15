import { LeadView } from './view';

export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function LeadPage() {
  return <LeadView />;
}
