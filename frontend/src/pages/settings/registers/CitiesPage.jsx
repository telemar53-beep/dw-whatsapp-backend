import { useState } from 'react';
import CitiesAdminTab from '../../../components/CitiesAdminTab';

function CitiesPage() {
  const [creating, setCreating] = useState(false);
  return <CitiesAdminTab creating={creating} onCreatingChange={setCreating} />;
}

export default CitiesPage;
