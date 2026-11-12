import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { PublicOnly, RequireAuth, RequireRole } from "./components/RouteGuards.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import RoleSelectionPage from "./pages/RoleSelectionPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import DicePage from "./pages/DicePage.jsx";
import LibraryPage from "./pages/LibraryPage.jsx";
import CampaignsPage from "./pages/CampaignsPage.jsx";
import PlaceholderPage from "./pages/PlaceholderPage.jsx";

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
                <Route path="characters" element={<PlaceholderPage eyebrow="Seus heróis" title="Personagens" description="Reúna fichas, atributos, habilidades e inventários em um só lugar." icon="characters" />} />
                <Route path="tabletop" element={<PlaceholderPage eyebrow="Jogo em tempo real" title="Mesa virtual" description="Mapas, tokens, chat e ferramentas para conduzir suas sessões." icon="tabletop" />} />
                <Route path="dice" element={<DicePage />} />
                <Route path="library" element={<LibraryPage />} />
                <Route path="friends" element={<PlaceholderPage eyebrow="Sua comunidade" title="Amigos" description="Encontre seus companheiros de aventura e organize grupos de jogo." icon="friends" />} />
                <Route path="settings" element={<PlaceholderPage eyebrow="Preferências" title="Configurações" description="Personalize sua experiência no REALMS." icon="settings" />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
