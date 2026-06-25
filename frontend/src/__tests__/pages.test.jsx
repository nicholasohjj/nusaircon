import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoadingPage from "../pages/LoadingPage";
import CardPaymentPage from "../pages/CardPaymentPage";
import ResultPage from "../pages/ResultPage";
import HomePage from "../pages/HomePage";

const WEB_PROFILE_STORAGE_KEY = "evs:webProfile";
const LEGACY_WEB_PROFILE_STORAGE_KEY = "nusaircon:webProfile";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Renders ui inside a MemoryRouter whose location includes the given search
 * params. useSearchParams() reads from the Router context, not window.location,
 * so this is the only way to reliably inject query params in tests.
 */
function renderWithRouter(ui, params = {}) {
  const search = Object.keys(params).length
    ? "?" + new URLSearchParams(params).toString()
    : "";
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/", search }]}>
      {ui}
    </MemoryRouter>,
  );
}

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

function getPgprHostelButton() {
  return screen.getByRole("button", {
    name: /^PGPR, Houses @ PGP, Residential Colleges, NUS College$/i,
  });
}

function getUtownHostelButton() {
  return screen.getByRole("button", {
    name: /^UTown Residence, RVRC$/i,
  });
}

function getSutdHostelButton() {
  return screen.getByRole("button", {
    name: /^SUTD$/i,
  });
}

// ── LoadingPage ───────────────────────────────────────────────────────────────

describe("LoadingPage", () => {
  const BASE_PARAMS = { txtMtrId: "12345678", txtAmount: "20", chatId: "" };

  beforeEach(() => {
    // Prevent real fetch — bootstrap call will fail, which is fine for smoke tests
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders meter ID from query params", () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    expect(screen.getByText("12345678")).toBeInTheDocument();
  });

  test("renders formatted amount from query params", () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    expect(screen.getByText(/SGD 20\.00/)).toBeInTheDocument();
  });

  test("renders page title", () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    expect(screen.getByText("EVS Payment")).toBeInTheDocument();
  });

  test("shows spinner on mount", () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    expect(document.querySelector("[class*='spinner']")).toBeTruthy();
  });

  test("shows error and retry button after fetch failure", async () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    await waitFor(() => {
      expect(screen.getByText(/Try Again/i)).toBeInTheDocument();
    });
  });

  test("shows error message after fetch failure", async () => {
    renderWithRouter(<LoadingPage basePath="" />, BASE_PARAMS);
    await waitFor(() => {
      expect(screen.getByText(/Unable to continue/i)).toBeInTheDocument();
    });
  });

  test("cp2nus basePath shows cp2nus in subtitle", () => {
    renderWithRouter(<LoadingPage basePath="/cp2nus" />, BASE_PARAMS);
    expect(screen.getByText(/cp2nus/i)).toBeInTheDocument();
  });

  test("renders address when present in query params", () => {
    renderWithRouter(<LoadingPage basePath="" />, {
      ...BASE_PARAMS,
      address: "Blk 12, 03-45 Sheares Hall",
    });
    expect(screen.getByText("Blk 12, 03-45 Sheares Hall")).toBeInTheDocument();
  });

  test("renders balance when present in query params", () => {
    renderWithRouter(<LoadingPage basePath="" />, {
      ...BASE_PARAMS,
      balance: "18.5",
    });
    expect(screen.getByText(/18\.50/)).toBeInTheDocument();
  });
});

// ── CardPaymentPage ───────────────────────────────────────────────────────────

describe("CardPaymentPage", () => {
  const SESSION = {
    ok: true,
    txtMtrId: "12345678",
    txtAmount: "20",
    address: "Blk 12, 03-45",
    balance: "18.50",
    n: "modulus",
    e: "exponent",
    netsMid: "807574000",
    netsTxnRef: "TXN001",
    merchantTxnRef: "MTR001",
  };

  const TOKEN_PARAMS = { token: "test-token-abc" };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("shows spinner while session is loading", () => {
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {})); // never resolves
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    expect(document.querySelector("[class*='spinner']")).toBeTruthy();
  });

  test("shows error when token is missing", () => {
    renderWithRouter(<CardPaymentPage basePath="" />, {});
    expect(screen.getByText(/Missing payment token/i)).toBeInTheDocument();
  });

  test("shows error when session fetch fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    await waitFor(() => {
      expect(screen.getAllByText(/Session expired/i).length).toBeGreaterThan(0);
    });
  });

  test("shows restart action on 400 response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    await waitFor(() => {
      expect(screen.getByText(/Start a new top-up/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Start Again/i }),
      ).toBeInTheDocument();
    });
  });

  test("uses restart URL when session expires", async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });

    renderWithRouter(<CardPaymentPage basePath="" />, {
      token: "test-token-abc",
      restartUrl: "/webapp?txtMtrId=12345678&txtAmount=20&chatId=999",
    });

    const restartButton = await screen.findByRole("button", {
      name: /Start Again/i,
    });
    fireEvent.click(restartButton);

    expect(assignSpy).toHaveBeenCalledWith(
      "/webapp?txtMtrId=12345678&txtAmount=20&chatId=999",
    );
  });

  test("renders card form after session loads", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SESSION,
    });
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/As printed on card/i),
      ).toBeInTheDocument();
    });
  });

  test("renders meter ID and amount in summary after session loads", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SESSION,
    });
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    await waitFor(() => {
      expect(screen.getByText("12345678")).toBeInTheDocument();
      expect(screen.getAllByText(/20\.00/).length).toBeGreaterThan(0);
    });
  });

  test("renders pay button with amount after session loads", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SESSION,
    });
    renderWithRouter(<CardPaymentPage basePath="" />, TOKEN_PARAMS);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Pay SGD 20\.00/i }),
      ).toBeInTheDocument();
    });
  });
});

// ── ResultPage ────────────────────────────────────────────────────────────────

describe("ResultPage", () => {
  let originalTelegram;

  beforeEach(() => {
    originalTelegram = window.Telegram;
    delete window.Telegram;
  });

  afterEach(() => {
    if (originalTelegram === undefined) {
      delete window.Telegram;
    } else {
      window.Telegram = originalTelegram;
    }
    vi.restoreAllMocks();
  });

  test("shows error when token is missing", () => {
    renderWithRouter(<ResultPage basePath="" />, {});
    expect(screen.getByText(/Missing result token/i)).toBeInTheDocument();
  });

  test("shows spinner while session is loading", () => {
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {}));
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    expect(document.querySelector("[class*='spinner']")).toBeTruthy();
  });

  test("shows session expired message on failed fetch", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "Session expired." }),
    });
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Session Expired/i }),
      ).toBeInTheDocument();
    });
  });

  test("renders success result page", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "success",
        txtMtrId: "12345678",
        txtAmount: "20",
        merchantTxnRef: "MTR-001",
        reason: "Payment completed.",
        address: "Blk 12, 03-45",
        balance: "18.50",
      }),
    });
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    await waitFor(() => {
      expect(screen.getByText("Top-Up Successful")).toBeInTheDocument();
    });
    expect(screen.getByText("Balance before top-up")).toBeInTheDocument();
  });

  test("renders negative pre-top-up balance with its sign", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "success",
        txtMtrId: "12345678",
        txtAmount: "20",
        merchantTxnRef: "MTR-001",
        reason: "Payment completed.",
        address: "",
        balance: "-2.50",
      }),
    });

    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });

    await waitFor(() => {
      expect(screen.getByText("Balance before top-up")).toBeInTheDocument();
      expect(screen.getByText("SGD -2.50")).toBeInTheDocument();
    });
  });

  test("renders failure result page", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "failure",
        txtMtrId: "12345678",
        txtAmount: "20",
        merchantTxnRef: "MTR-002",
        reason: "Transaction is rejected by financial institution.",
        address: "",
        balance: "",
      }),
    });
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    await waitFor(() => {
      expect(screen.getByText("Top-Up Failed")).toBeInTheDocument();
      expect(
        screen.getByText(/rejected by financial institution/i),
      ).toBeInTheDocument();
    });
  });

  test("renders meter ID and reference on success", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "success",
        txtMtrId: "12345678",
        txtAmount: "20",
        merchantTxnRef: "MTR-001",
        reason: "Payment completed.",
        address: "",
        balance: "",
      }),
    });
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    await waitFor(() => {
      expect(screen.getByText("12345678")).toBeInTheDocument();
      expect(screen.getByText("MTR-001")).toBeInTheDocument();
    });
  });

  test("renders standalone Top Up Again and Done buttons", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "success",
        txtMtrId: "12345678",
        txtAmount: "20",
        merchantTxnRef: "MTR-001",
        reason: "Payment completed.",
        address: "",
        balance: "",
      }),
    });
    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Top Up Again/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Done/i }),
      ).toBeInTheDocument();
    });
  });

  test("preserves chatId when topping up again", async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "success",
        txtMtrId: "12345678",
        txtAmount: "20",
        chatId: "999",
        merchantTxnRef: "MTR-001",
        reason: "Payment completed.",
        address: "",
        balance: "",
      }),
    });

    renderWithRouter(<ResultPage basePath="/cp2nus" />, {
      token: "test-token",
    });

    const topUpAgainButton = await screen.findByRole("button", {
      name: /Top Up Again/i,
    });
    fireEvent.click(topUpAgainButton);

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith(
        "/cp2nus/webapp?txtMtrId=12345678&txtAmount=20&chatId=999",
      );
    });
  });

  test("renders Close inside Telegram WebApp", async () => {
    window.Telegram = {
      WebApp: {
        ready: vi.fn(),
        expand: vi.fn(),
        close: vi.fn(),
      },
    };

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        status: "success",
        txtMtrId: "12345678",
        txtAmount: "20",
        chatId: "999",
        merchantTxnRef: "MTR-001",
        reason: "Payment completed.",
        address: "",
        balance: "",
      }),
    });

    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });

    const closeButton = await screen.findByRole("button", {
      name: /Close/i,
    });
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(window.Telegram.WebApp.close).toHaveBeenCalled();
    });
  });

  test("verifies the latest balance on demand", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: "success",
          txtMtrId: "12345678",
          txtAmount: "20",
          merchantTxnRef: "MTR-001",
          reason: "Payment completed.",
          address: "",
          balance: "18.50",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          txtMtrId: "12345678",
          balance: "24.50",
        }),
      });

    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });

    const verifyButton = await screen.findByRole("button", {
      name: /Verify Balance/i,
    });
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByText("Verified balance")).toBeInTheDocument();
      expect(screen.getByText("SGD 24.50")).toBeInTheDocument();
    });
  });

  test("renders negative verified balance with its sign", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: "success",
          txtMtrId: "12345678",
          txtAmount: "20",
          merchantTxnRef: "MTR-001",
          reason: "Payment completed.",
          address: "",
          balance: "1.50",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          txtMtrId: "12345678",
          balance: "-0.75",
        }),
      });

    renderWithRouter(<ResultPage basePath="" />, { token: "test-token" });

    const verifyButton = await screen.findByRole("button", {
      name: /Verify Balance/i,
    });
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(screen.getByText("Verified balance")).toBeInTheDocument();
      expect(screen.getByText("SGD -0.75")).toBeInTheDocument();
    });
  });
});

// ── HomePage ──────────────────────────────────────────────────────────────────

describe("HomePage › static rendering", () => {
  test("renders page title", () => {
    renderHomePage();
    expect(
      screen.getByRole("heading", { name: /EVS Meter Tools/i }),
    ).toBeInTheDocument();
  });

  test("renders hostel group buttons", () => {
    renderHomePage();
    expect(getPgprHostelButton()).toBeInTheDocument();
    expect(getUtownHostelButton()).toBeInTheDocument();
  });

  test("renders meter ID input", () => {
    renderHomePage();
    expect(
      screen.getByPlaceholderText(/8-digit meter ID/i),
    ).toBeInTheDocument();
  });

  test("renders amount input", () => {
    renderHomePage();
    expect(screen.getByPlaceholderText(/6\.00/i)).toBeInTheDocument();
  });

  test("renders all four preset buttons", () => {
    renderHomePage();
    expect(screen.getByRole("button", { name: "$10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$20" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$30" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$50" })).toBeInTheDocument();
  });

  test("renders continue button", () => {
    renderHomePage();
    expect(
      screen.getByRole("button", { name: /Continue/i }),
    ).toBeInTheDocument();
  });
});

describe("HomePage › hostel selection", () => {
  test("no group is active on initial render", () => {
    renderHomePage();
    const pgprBtn = getPgprHostelButton();
    expect(pgprBtn.className).not.toMatch(/Active/i);
  });

  test("clicking a group marks it active", () => {
    renderHomePage();
    const pgprBtn = getPgprHostelButton();
    fireEvent.click(pgprBtn);
    expect(pgprBtn.className).toMatch(/Active/i);
  });

  test("clicking second group deactivates the first", () => {
    renderHomePage();
    const pgprBtn = getPgprHostelButton();
    const utownBtn = getUtownHostelButton();
    fireEvent.click(pgprBtn);
    fireEvent.click(utownBtn);
    expect(pgprBtn.className).not.toMatch(/Active/i);
    expect(utownBtn.className).toMatch(/Active/i);
  });
});

describe("HomePage › saved meters", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  test("loads and selects multiple saved meters", () => {
    window.localStorage.setItem(
      WEB_PROFILE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeId: "0:12345678",
        profiles: [
          {
            id: "0:12345678",
            label: "Room",
            meterId: "12345678",
            groupIndex: 0,
            savedAt: 1,
          },
          {
            id: "1:87654321",
            label: "Friend",
            meterId: "87654321",
            groupIndex: 1,
            savedAt: 2,
          },
        ],
      }),
    );

    renderHomePage();
    expect(screen.getByRole("button", { name: /^Room/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Friend/i }));

    expect(screen.getByPlaceholderText(/8-digit meter ID/i).value).toBe(
      "87654321",
    );
    expect(getUtownHostelButton().className).toMatch(/Active/i);
  });

  test("migrates the old single saved meter shape", () => {
    window.localStorage.setItem(
      WEB_PROFILE_STORAGE_KEY,
      JSON.stringify({
        groupIndex: 0,
        meterId: "12345678",
      }),
    );

    renderHomePage();

    expect(
      screen.getByRole("button", { name: /^Meter 5678/i }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/8-digit meter ID/i).value).toBe(
      "12345678",
    );
  });

  test("migrates saved meters from the old nusaircon storage key", () => {
    window.localStorage.setItem(
      LEGACY_WEB_PROFILE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeId: "0:12345678",
        profiles: [
          {
            id: "0:12345678",
            label: "Legacy",
            meterId: "12345678",
            groupIndex: 0,
            savedAt: 1,
          },
        ],
      }),
    );

    renderHomePage();

    expect(screen.getByRole("button", { name: /^Legacy/i })).toBeInTheDocument();
  });

  test("forgets one saved meter without clearing the others", () => {
    window.localStorage.setItem(
      WEB_PROFILE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeId: "0:12345678",
        profiles: [
          {
            id: "0:12345678",
            label: "Room",
            meterId: "12345678",
            groupIndex: 0,
            savedAt: 1,
          },
          {
            id: "1:87654321",
            label: "Friend",
            meterId: "87654321",
            groupIndex: 1,
            savedAt: 2,
          },
        ],
      }),
    );

    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Forget Room/i }));

    expect(screen.queryByRole("button", { name: /Room/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Friend/i })).toBeInTheDocument();
  });

  test("saved meter balance action checks the selected meter", async () => {
    window.localStorage.setItem(
      WEB_PROFILE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeId: "0:12345678",
        profiles: [
          {
            id: "0:12345678",
            label: "Room",
            meterId: "12345678",
            groupIndex: 0,
            savedAt: 1,
          },
        ],
      }),
    );
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        mode: "balance",
        meterId: "12345678",
        address: "",
        balance: "12.5",
        checkedAt: "2026-06-24T12:00:00.000Z",
      }),
    });

    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Balance Room/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/website/lookup?meterId=12345678&mode=balance",
      );
      expect(screen.getByText("SGD 12.50")).toBeInTheDocument();
    });
  });

  test("saved meter top-up action opens the top-up form for that meter", () => {
    window.localStorage.setItem(
      WEB_PROFILE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeId: "1:87654321",
        profiles: [
          {
            id: "1:87654321",
            label: "Friend",
            meterId: "87654321",
            groupIndex: 1,
            savedAt: 1,
          },
        ],
      }),
    );

    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /^Usage$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Top up Friend/i }));

    expect(screen.getByPlaceholderText(/8-digit meter ID/i).value).toBe(
      "87654321",
    );
    expect(screen.getByPlaceholderText(/Room, Friend/i).value).toBe("Friend");
    expect(screen.getByPlaceholderText(/6\.00/i)).toBeInTheDocument();
  });
});

describe("HomePage › amount presets", () => {
  test("clicking $20 preset fills the amount input", () => {
    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: "$20" }));
    expect(screen.getByPlaceholderText(/6\.00/i).value).toBe("20");
  });

  test("clicking a preset marks it active", () => {
    renderHomePage();
    const btn = screen.getByRole("button", { name: "$30" });
    fireEvent.click(btn);
    expect(btn.className).toMatch(/Active/i);
  });

  test("clicking a different preset deactivates the previous one", () => {
    renderHomePage();
    const btn10 = screen.getByRole("button", { name: "$10" });
    const btn50 = screen.getByRole("button", { name: "$50" });
    fireEvent.click(btn10);
    fireEvent.click(btn50);
    expect(btn10.className).not.toMatch(/Active/i);
    expect(btn50.className).toMatch(/Active/i);
  });
});

describe("HomePage › validation", () => {
  test("shows all three errors when form is submitted empty", () => {
    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByText(/Please select your hostel/i)).toBeInTheDocument();
    expect(screen.getByText(/Must be exactly 8 digits/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Between \$6\.00 and \$50\.00/i),
    ).toBeInTheDocument();
  });

  test("shows meter ID error for non-8-digit input", () => {
    renderHomePage();
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByText(/Must be exactly 8 digits/i)).toBeInTheDocument();
  });

  test("shows amount error when amount is below minimum", () => {
    renderHomePage();
    fireEvent.change(screen.getByPlaceholderText(/6\.00/i), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      screen.getByText(/Between \$6\.00 and \$50\.00/i),
    ).toBeInTheDocument();
  });

  test("shows amount error when amount exceeds maximum", () => {
    renderHomePage();
    fireEvent.change(screen.getByPlaceholderText(/6\.00/i), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      screen.getByText(/Between \$6\.00 and \$50\.00/i),
    ).toBeInTheDocument();
  });

  test("meter ID field strips non-numeric characters", () => {
    renderHomePage();
    const input = screen.getByPlaceholderText(/8-digit meter ID/i);
    fireEvent.change(input, { target: { value: "abc12345xyz" } });
    expect(input.value).toBe("12345");
  });

  test("meter ID field enforces 8 character maximum", () => {
    renderHomePage();
    const input = screen.getByPlaceholderText(/8-digit meter ID/i);
    fireEvent.change(input, { target: { value: "123456789" } });
    expect(input.value).toBe("12345678");
  });

  test("clears meter ID error after correcting input", () => {
    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByText(/Must be exactly 8 digits/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "12345678" },
    });
    expect(
      screen.queryByText(/Must be exactly 8 digits/i),
    ).not.toBeInTheDocument();
  });

  test("clears amount error after correcting input", () => {
    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      screen.getByText(/Between \$6\.00 and \$50\.00/i),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/6\.00/i), {
      target: { value: "20" },
    });
    expect(
      screen.queryByText(/Between \$6\.00 and \$50\.00/i),
    ).not.toBeInTheDocument();
  });
});

describe("HomePage › lookup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  test("renders negative balances with their sign", async () => {
    window.localStorage.clear();
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        mode: "balance",
        meterId: "12345678",
        address: "",
        balance: "-2.5",
        checkedAt: "2026-06-24T12:00:00.000Z",
      }),
    });

    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /^Balance$/i }));
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "12345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check Meter/i }));

    await waitFor(() => {
      expect(screen.getByText("SGD -2.50")).toBeInTheDocument();
    });
  });

  test("suggests a top-up amount from recent usage", async () => {
    window.localStorage.clear();
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        mode: "usage",
        meterId: "12345678",
        address: "",
        balance: "2",
        checkedAt: "2026-06-24T12:00:00.000Z",
        usage: {
          days: 7,
          history: [],
          analysis: {
            avgDaily: 2,
            lastDay: 2,
            total: 14,
            warnings: [],
          },
          rank: null,
          monthToDate: 20,
        },
      }),
    });

    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /^Usage$/i }));
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "12345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check Meter/i }));

    const useRecommendation = await screen.findByRole("button", {
      name: /Use SGD 18/i,
    });
    expect(
      screen.getByText("Top up SGD 18 to last about 10 days."),
    ).toBeInTheDocument();

    fireEvent.click(useRecommendation);

    expect(screen.getByPlaceholderText(/6\.00/i).value).toBe("18");
  });

  test("routes SUTD top-up history lookup through the SUTD system", async () => {
    window.localStorage.clear();
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        mode: "topups",
        meterId: "20000596",
        hostel: "sutd",
        address: "",
        balance: "5.40",
        checkedAt: "2026-06-25T11:19:37.000Z",
        topups: {
          source: "sutd",
          lookbackDays: null,
          history: [
            {
              date: "08/05/2026 09:50",
              amount: 10,
              reference: "RP26050800000002",
              status: "Yes",
            },
          ],
        },
      }),
    });

    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /^Top-ups$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^SUTD$/i }));
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "20000596" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check Meter/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/website/lookup?meterId=20000596&mode=topups&hostel=sutd",
      );
      expect(screen.getByText("SGD 10.00")).toBeInTheDocument();
    });
  });
});

describe("HomePage › submission", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("navigates to cp2 webapp URL on valid PGPR submission", () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    renderHomePage();
    fireEvent.click(getPgprHostelButton());
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "12345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "$20" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    expect(assignSpy).toHaveBeenCalledWith(expect.stringContaining("/webapp?"));
    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("txtMtrId=12345678"),
    );
    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("txtAmount=20"),
    );
    // cp2 (PGPR) uses the root basePath — no /cp2nus prefix
    expect(assignSpy).toHaveBeenCalledWith(
      expect.not.stringContaining("cp2nus"),
    );
  });

  test("navigates to cp2nus webapp URL on valid UTown submission", () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    renderHomePage();
    fireEvent.click(getUtownHostelButton());
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "87654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "$10" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("/cp2nus/webapp?"),
    );
    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("txtMtrId=87654321"),
    );
  });

  test("navigates to SUTD webapp URL on valid SUTD submission", () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    renderHomePage();
    fireEvent.click(getSutdHostelButton());
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "20000596" },
    });
    fireEvent.click(screen.getByRole("button", { name: "$10" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("/sutd/webapp?"),
    );
    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("txtMtrId=20000596"),
    );
    expect(assignSpy).toHaveBeenCalledWith(
      expect.stringContaining("txtAmount=10"),
    );
  });

  test("does not navigate for SUTD amount below the minimum", () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    renderHomePage();
    fireEvent.click(getSutdHostelButton());
    fireEvent.change(screen.getByPlaceholderText(/8-digit meter ID/i), {
      target: { value: "20000596" },
    });
    fireEvent.change(screen.getByLabelText(/Amount/i), {
      target: { value: "9" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByText(/Between \$10\.00 and \$50\.00/i)).toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  test("does not navigate when form is invalid", () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
    Object.defineProperty(window.location, "href", {
      set: assignSpy,
      get: () => "",
    });

    renderHomePage();
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
