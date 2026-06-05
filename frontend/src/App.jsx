import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import RequirementConfig from './pages/RequirementConfig';
import OnboardVerification from './pages/OnboardVerification';
import MerchantAnalysis from './pages/MerchantAnalysis';
import Documents from './pages/Documents';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Navigate to="/login" replace />} />
        <Route
          path="/onboard-verification"
          element={
            <ProtectedRoute>
              <OnboardVerification />
            </ProtectedRoute>
          }
        />
        <Route
          path="/merchant-analysis"
          element={
            <ProtectedRoute>
              <MerchantAnalysis />
            </ProtectedRoute>
          }
        />
        <Route
          path="/requirement-config"
          element={
            <ProtectedRoute>
              <RequirementConfig />
            </ProtectedRoute>
          }
        />
        <Route
          path="/documents"
          element={
            <ProtectedRoute>
              <Documents />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
