import { useState } from 'react';
import PlansAdminTab from '../../../components/PlansAdminTab';

function PlansPage() {
  const [creating, setCreating] = useState(false);
  return <PlansAdminTab creating={creating} onCreatingChange={setCreating} />;
}

export default PlansPage;
