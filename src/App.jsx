import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { PublicOnly, RequireAuth, RequireRole } from "./components/RouteGuards.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import RoleSelectionPage from "./pages/RoleSelectionPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import LibraryPage from "./pages/LibraryPage.jsx";
import CampaignsPage from "./pages/CampaignsPage.jsx";
import CharactersPage from "./pages/CharactersPage.jsx";
import SessionPage from "./pages/SessionPage.jsx";
import AccountPage from "./pages/AccountPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import FriendsPage from "./pages/FriendsPage.jsx";
import CampaignDetailPage from "./pages/CampaignDetailPage.jsx";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path="/auth" element={<AuthPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/choose-role" element={<RoleSelectionPage />} />
            <Route element={<RequireRole />}>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="campaigns" element={<CampaignsPage />} />
                <Route path="campaigns/:campaignId" element={<CampaignDetailPage />} />
                <Route path="characters" element={<CharactersPage />} />
                <Route path="tabletop" element={<Navigate to="/campaigns" replace />} />
                <Route path="library" element={<LibraryPage />} />
                <Route path="friends" element={<FriendsPage />} />
                <Route path="account" element={<AccountPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
              <Route path="tabletop/:sessionId" element={<SessionPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
