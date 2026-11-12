import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import DicePage from "./pages/DicePage.jsx";
import PlaceholderPage from "./pages/PlaceholderPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="campaigns"
            element={
              <PlaceholderPage
                eyebrow="Suas aventuras"
                title="Campanhas"
                description="Crie mundos, convide jogadores e acompanhe o progresso de cada aventura."
                icon="campaigns"
              />
            }
          />
          <Route
            path="characters"
            element={
              <PlaceholderPage
                eyebrow="Seus heróis"
                title="Personagens"
                description="Reúna fichas, atributos, habilidades e inventários em um só lugar."
                icon="characters"
              />
            }
          />
          <Route
            path="tabletop"
            element={
              <PlaceholderPage
                eyebrow="Jogo em tempo real"
                title="Mesa virtual"
                description="Mapas, tokens, chat e ferramentas para conduzir suas sessões."
                icon="tabletop"
              />
            }
          />
          <Route path="dice" element={<DicePage />} />
          <Route
            path="library"
            element={
              <PlaceholderPage
                eyebrow="Conhecimento"
                title="Biblioteca"
                description="Organize sistemas, regras, criaturas, itens e conteúdos das suas campanhas."
                icon="library"
              />
            }
          />
          <Route
            path="friends"
            element={
              <PlaceholderPage
                eyebrow="Sua comunidade"
                title="Amigos"
                description="Encontre seus companheiros de aventura e organize grupos de jogo."
                icon="friends"
              />
            }
          />
          <Route
            path="settings"
            element={
              <PlaceholderPage
                eyebrow="Preferências"
                title="Configurações"
                description="Personalize sua experiência no REALMS."
                icon="settings"
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
