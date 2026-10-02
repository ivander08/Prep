/**
 * Job-description keyword coverage.
 *
 * The extractor's job is to keep the terms a posting is most likely to be screened on and drop the
 * boilerplate around them. The tests pin the two ways that goes wrong: shredding `c++`/`ci/cd` into
 * fragments, and padding the list with words every posting contains.
 */

import { describe, expect, test } from "bun:test";
import { extractKeywords, jdCoverage } from "./keywords.ts";
import type { CvDoc } from "./doc.ts";

const JD = `
We are looking for a strong backend engineer to join our team. You will have experience with
C++ and PostgreSQL, and familiarity with Kubernetes and Docker. Requirements include a strong
understanding of distributed systems and CI/CD pipelines. The candidate should have experience
with Kafka and Terraform. You will work with the team on our platform.
`;

function doc(overrides: Partial<CvDoc> = {}): CvDoc {
  return {
    name: "Jane Doe",
    email: "jane@example.com",
    links: [],
    sections: [],
    skills: [],
    ...overrides,
  };
}

describe("extractKeywords", () => {
  test("keeps C++, PostgreSQL and Kubernetes as terms", () => {
    const terms = extractKeywords(JD);
    expect(terms).toContain("c++");
    expect(terms).toContain("postgresql");
    expect(terms).toContain("kubernetes");
    expect(terms).toContain("docker");
  });

  test("keeps ci/cd and node.js intact rather than shredding them", () => {
    const terms = extractKeywords("We use CI/CD and Node.js and c# daily.");
    expect(terms).toContain("ci/cd");
    expect(terms).toContain("node.js");
    expect(terms).toContain("c#");
    // The fragments the split would otherwise produce.
    expect(terms).not.toContain("cd");
    expect(terms).not.toContain("js");
  });

  test("drops recruiter boilerplate", () => {
    const terms = extractKeywords(JD);
    for (const boiler of ["experience", "strong", "team", "candidate", "requirements", "work", "years", "ability"]) {
      expect(terms).not.toContain(boiler);
    }
  });

  test("ranks a repeated term above a one-off, and respects the limit", () => {
    const terms = extractKeywords("kafka kafka kafka terraform redis", 3);
    expect(terms[0]).toBe("kafka");
    expect(terms.length).toBeLessThanOrEqual(3);
  });

  test("an empty or boilerplate-only description yields nothing", () => {
    expect(extractKeywords("")).toEqual([]);
    expect(extractKeywords("we are looking for a strong candidate")).toEqual([]);
  });
});

describe("jdCoverage", () => {
  test("marks present terms and counts only the ones in the document", () => {
    const d = doc({
      summary: "Backend engineer with PostgreSQL and Kubernetes experience.",
      skills: [{ label: "Languages", items: ["C++"] }],
    });

    const { rows, covered, total } = jdCoverage(JD, d);
    expect(total).toBeGreaterThan(0);

    const byTerm = new Map(rows.map((r) => [r.term, r]));
    expect(byTerm.get("c++")!.present).toBe(true);
    expect(byTerm.get("c++")!.inSkills).toBe(true);
    expect(byTerm.get("postgresql")!.present).toBe(true);
    expect(byTerm.get("postgresql")!.inSummary).toBe(true);
    expect(byTerm.get("kubernetes")!.present).toBe(true);
    expect(byTerm.get("terraform")!.present).toBe(false);

    expect(covered).toBe(rows.filter((r) => r.present).length);
    expect(covered).toBeLessThan(total);
  });

  test("an empty CV covers nothing", () => {
    const { rows, covered } = jdCoverage(JD, doc());
    expect(rows.length).toBeGreaterThan(0);
    expect(covered).toBe(0);
  });
});
