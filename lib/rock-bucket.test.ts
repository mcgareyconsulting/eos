import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isCompanyRock, isTeamRock, rockBucket } from "./rock-bucket";

const owner = "u-1";

describe("rockBucket — placement ladder", () => {
  test("neither flag → owner", () => {
    assert.equal(rockBucket({ owner_id: owner, rock_type: "individual" }), "owner");
    assert.equal(rockBucket({ owner_id: owner, rock_type: null }), "owner");
  });

  test("Team only → department", () => {
    assert.equal(
      rockBucket({ owner_id: owner, rock_type: "department" }),
      "department",
    );
  });

  test("Company + Individual → company (not department)", () => {
    assert.equal(
      rockBucket({ owner_id: owner, rock_type: "individual", is_company_rock: true }),
      "company",
    );
  });

  test("Company + Team → company; both pills still apply", () => {
    const r = { owner_id: owner, rock_type: "department", is_company_rock: true };
    assert.equal(rockBucket(r), "company");
    assert.equal(isCompanyRock(r), true);
    assert.equal(isTeamRock(r), true);
  });

  test("legacy null owner → department", () => {
    assert.equal(rockBucket({ owner_id: null, rock_type: null }), "department");
    assert.equal(rockBucket({ owner_id: "", rock_type: "individual" }), "department");
  });

  test("legacy rock_type 'company' → company bucket, Company + Team pills", () => {
    const r = { owner_id: owner, rock_type: "company" };
    assert.equal(rockBucket(r), "company");
    assert.equal(isCompanyRock(r), true);
    assert.equal(isTeamRock(r), true);
  });

  test("is_company_rock false / missing is not Company", () => {
    assert.equal(isCompanyRock({ owner_id: owner, is_company_rock: false }), false);
    assert.equal(isCompanyRock({ owner_id: owner }), false);
  });
});
