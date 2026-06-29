import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import LoadingPage from "./pages/LoadingPage";
import CardPaymentPage from "./pages/CardPaymentPage";
import ResultPage from "./pages/ResultPage";
import TermsPage from "./pages/TermsPage";

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
        {/* Entry point — hostel selection + meter details */}
        <Route path="/" element={<HomePage />} />
        <Route path="/cp2" element={<HomePage initialGroupId="cp2" />} />
        <Route
          path="/cp2nus"
          element={<HomePage initialGroupId="cp2nus" />}
        />
        <Route
          path="/balance"
          element={<HomePage initialMode="balance" landingKey="balance" />}
        />
        <Route path="/sutd" element={<HomePage initialGroupId="sutd" />} />
        <Route path="/terms" element={<TermsPage />} />

        {/* cp2 flow — PGPR, PGP Houses except Valour House, Residential Colleges, NUS College */}
        <Route path="/loading" element={<LoadingPage basePath="" />} />
        <Route path="/pay" element={<CardPaymentPage basePath="" />} />
        <Route path="/result" element={<ResultPage basePath="" />} />

        {/* cp2nus flow — UTown Residence, RVRC, Valour House */}
        <Route
          path="/cp2nus/loading"
          element={<LoadingPage basePath="/cp2nus" />}
        />
        <Route
          path="/cp2nus/pay"
          element={<CardPaymentPage basePath="/cp2nus" />}
        />
        <Route
          path="/cp2nus/result"
          element={<ResultPage basePath="/cp2nus" />}
        />

        {/* SUTD flow */}
        <Route
          path="/sutd/loading"
          element={<LoadingPage basePath="/sutd" />}
        />
        <Route path="/sutd/pay" element={<CardPaymentPage basePath="/sutd" />} />
        <Route path="/sutd/result" element={<ResultPage basePath="/sutd" />} />
      </Routes>
    </BrowserRouter>
  );
}
