import { useState } from 'react';
import SectorsAdminTab from '../../../components/SectorsAdminTab';

function SectorsPage() {
  const [creating, setCreating] = useState(false);
  return <SectorsAdminTab creating={creating} onCreatingChange={setCreating} />;
}

export default SectorsPage;
