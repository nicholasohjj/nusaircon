import { describe, expect, test } from "vitest";

const {
  buildSutdPassword,
  classifySutdLoginResponse,
  classifySutdWebposLoginResponse,
  classifySutdWebposSelectOfferResponse,
  isValidSutdAmount,
  parseSutdMeterCredit,
  parseSutdTransactionSummary,
  parseSutdTransactionRows,
  parseSutdWebposPageMessage,
  parseSutdWebposMeterDetails,
} = require("../services/sutdService");

describe("sutdService", () => {
  test("builds the SUTD password pattern from an 8-digit meter ID", () => {
    expect(buildSutdPassword("20000596")).toBe("SU0596td");
    expect(buildSutdPassword("1234")).toBe("");
  });

  test("classifies a successful SUTD login frame response", () => {
    expect(
      classifySutdLoginResponse(`
        <html><head><title>EVS-SUTD</title></head>
        <frameset>
          <frame src="/SUTDMain/common/common_leftMenu.jsp" />
        </frameset></html>
      `),
    ).toBe("valid");
  });

  test("classifies SUTD WebPOS top-up pages", () => {
    expect(
      classifySutdWebposLoginResponse(`
        <title>EVS POS Package Selection Page</title>
        <form action="/EVSSUTDWebPOS/selectOfferServlet">
          Please confirm you are purchasing for the above premise.
        </form>
      `),
    ).toBe("valid");

    expect(
      classifySutdWebposSelectOfferResponse(`
        <title>EVS POS Payment Selection Page</title>
        <input type="hidden" name="hidPurAmt" id="hidPurAmt" value="10.0" />
        Please select a payment mode :
      `),
    ).toBe("success");
  });

  test("validates SUTD top-up amount range", () => {
    expect(isValidSutdAmount("10")).toBe(true);
    expect(isValidSutdAmount("50.00")).toBe(true);
    expect(isValidSutdAmount("9.99")).toBe(false);
    expect(isValidSutdAmount("50.01")).toBe(false);
  });

  test("parses SUTD transaction history rows", () => {
    const rows = parseSutdTransactionRows(`
      <table>
        <tr class="tblRow" style="cursor:default">
          <td>RP26050800000002</td>
          <td>08/05/2026 09:50</td>
          <td align="right">10.00&nbsp;</td>
          <td>RP230500</td>
          <td>Credit Card</td>
          <td>POS AXS</td>
          <td>Yes</td>
        </tr>
      </table>
    `);

    expect(rows).toEqual([
      {
        transaction_id: "RP26050800000002",
        date: "08/05/2026 09:50",
        amount: "10.00",
        offer_id: "RP230500",
        payment_mode: "Credit Card",
        channel: "POS AXS",
        status: "Yes",
        source: "sutd",
      },
    ]);
  });

  test("parses SUTD meter credit", () => {
    const summary = parseSutdMeterCredit(`
      <table>
        <tr>
          <td class="mainContent_formLabel">Meter ID:</td>
          <td><font class="mainContent_normalText">20000596</font></td>
          <td align="right"><font class="mainContent_normalText">Total Balance: S$ 5.40</font></td>
        </tr>
        <tr>
          <td class="mainContent_formLabel">Package ID:</td>
          <td colspan="2"><font class="mainContent_normalText">RP230500</font></td>
        </tr>
        <tr>
          <td class="mainContent_formLabel">Last Recorded Credit:</td>
          <td colspan="2"><font class="mainContent_normalText">S$ 5.40</font></td>
        </tr>
        <tr>
          <td class="mainContent_formLabel">Last Recorded Timestamp:</td>
          <td colspan="2"><font class="mainContent_normalText">25/06/2026 00:48:53</font></td>
        </tr>
      </table>
    `);

    expect(summary.credit_bal).toBe("5.40");
    expect(summary.meter_info).toMatchObject({
      meter_displayname: "20000596",
      package_id: "RP230500",
      last_recorded_credit: "5.40",
      last_recorded_timestamp: "25/06/2026 00:48:53",
      source: "sutd",
    });
  });

  test("parses SUTD WebPOS meter address from login response", () => {
    const details = parseSutdWebposMeterDetails(`
      <table>
        <tr>
          <td class="pnlHeader" width="100px">Meter ID</td>
          <td class="pnlHeader" width="10px">:</td>
          <td class="pnlHeader"><u><b>20000596<b></u></td>
        </tr>
        <tr>
          <td class="pnlHeader" width="100px">Address</td>
          <td class="pnlHeader" width="10px">:</td>
          <td class="pnlHeader">
            <u><b>59 , 8 , 115 , NA</b></u>
          </td>
        </tr>
      </table>
      <td colspan="2" class="lblMessage">
        You have 2 POS request in processing. Please try again 10 minutes later.
      </td>
    `);

    expect(details).toEqual({
      meter_displayname: "20000596",
      address: "59, 8, 115, NA",
      source: "sutd",
    });
  });

  test("parses SUTD WebPOS blocking messages", () => {
    const message = parseSutdWebposPageMessage(`
      <td colspan="2" class="lblMessage" height="320px">
        You have 2 POS request in processing. Please try again 10 minutes later.<br/>
        You are not allowed to buy another package(Maximum TWO packages per household).
      </td>
    `);

    expect(message).toBe(
      "You have 2 POS request in processing. Please try again 10 minutes later. You are not allowed to buy another package(Maximum TWO packages per household).",
    );
  });

  test("does not treat empty SUTD transaction summary as success", () => {
    const summary = parseSutdTransactionSummary("");
    expect(summary.status).toBe("unknown");
    expect(summary.reason).toBe("Unable to determine transaction outcome.");
  });

  test("parses SUTD financial institution rejection summary", () => {
    const summary = parseSutdTransactionSummary(`
      <html>
        <head><title>EVS POS Transaction Summary Page</title></head>
        <body>
          <form method="post" action="https://nus-utown.evs.com.sg/EVSSUTDWebPOS/transSumServlet?status=0&amp;id=RP26062600000036"></form>
          <table>
            <tr>
              <td><b>Meter ID</b></td>
              <td><b>:</b></td>
              <td><b><u>20000595</u></b></td>
            </tr>
            <tr>
              <td><b>Address</b></td>
              <td><b>:</b></td>
              <td><b><u>59 , 9 , 91 , NA</u></b></td>
            </tr>
            <tr>
              <td colspan="3"><b> Failed to purchase the following :</b></td>
            </tr>
            <tr>
              <td><b>Total Amount (Inclusive of GST)</b></td>
              <td><b>:</b></td>
              <td><b>S$ 10.00</b></td>
            </tr>
            <tr>
              <td colspan="3">
                <span name="lblAlert" id="lblAlert">Transaction is rejected by financial institution.</span>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `);

    expect(summary).toMatchObject({
      title: "EVS POS Transaction Summary Page",
      merchantTxnRef: "RP26062600000036",
      meterId: "20000595",
      address: "59 , 9 , 91 , NA",
      amount: "S$ 10.00",
      status: "failure",
      reason: "Transaction is rejected by financial institution.",
    });
  });
});
