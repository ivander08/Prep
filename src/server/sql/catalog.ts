/**
 * The SQL 50 reference queries: one hand-written answer per problem, keyed by slug.
 *
 * This file is the grading oracle AND the answer key. It is server-only: the routes that serve
 * a problem's detail send the statement, the schema and the seed rows, never the entry here.
 * The exemplar is revealed in the UI only after a pass, the same rule the concept, component
 * and DSA tracks already follow — reading the answer first is how a problem feels learned
 * without being learned.
 *
 * Two constraints shaped every query:
 *
 * 1. **SQLite, not MySQL.** The seed data is `metaData.mysql` normalized by `run.ts`, so the
 *    queries run on the SQLite build inside Bun (3.53.2). Where a problem's canonical answer
 *    uses a construct SQLite lacks, the query is rewritten to an equivalent: nothing here uses
 *    `PERCENTILE_CONT`, and `HAVING` is never used on a non-aggregate query.
 * 2. **`GROUP_CONCAT(DISTINCT x ORDER BY x)` is a syntax error in SQLite.** The one problem
 *    that needs an ordered, de-duplicated concatenation (`group-sold-products-by-the-date`)
 *    uses a correlated subquery over a `SELECT DISTINCT … ORDER BY` instead.
 *
 * `catalog.test.ts` proves every query here executes against the real stored seed data for its
 * problem, and that this key set equals the `sql50` slug set exactly. That is what makes
 * reference-query grading trustworthy rather than a claim: a wrong oracle would otherwise grade
 * a correct answer as wrong, which is worse than not grading at all.
 */

export const SQL_SOLUTIONS: Record<string, string> = {
  "recyclable-and-low-fat-products":
    "SELECT product_id FROM Products WHERE low_fats = 'Y' AND recyclable = 'Y'",

  "find-customer-referee":
    "SELECT name FROM Customer WHERE referee_id IS NULL OR referee_id <> 2",

  "big-countries":
    "SELECT name, population, area FROM World WHERE area >= 3000000 OR population >= 25000000",

  "article-views-i":
    "SELECT DISTINCT author_id AS id FROM Views WHERE author_id = viewer_id ORDER BY id",

  "invalid-tweets":
    "SELECT tweet_id FROM Tweets WHERE LENGTH(content) > 15",

  "replace-employee-id-with-the-unique-identifier":
    "SELECT u.unique_id, e.name FROM Employees e LEFT JOIN EmployeeUNI u ON u.id = e.id",

  "product-sales-analysis-i":
    "SELECT p.product_name, s.year, s.price FROM Sales s JOIN Product p ON p.product_id = s.product_id",

  "customer-who-visited-but-did-not-make-any-transactions":
    `SELECT v.customer_id, COUNT(*) AS count_no_trans
     FROM Visits v
     WHERE NOT EXISTS (SELECT 1 FROM Transactions t WHERE t.visit_id = v.visit_id)
     GROUP BY v.customer_id`,

  "rising-temperature":
    `SELECT w.id
     FROM Weather w
     JOIN Weather y ON y.recordDate = date(w.recordDate, '-1 day')
     WHERE w.temperature > y.temperature`,

  // The 'start'/'end' pair is collapsed per (machine, process) before averaging, because an
  // average over the raw rows would mix timestamps from different processes.
  "average-time-of-process-per-machine":
    `SELECT machine_id, ROUND(AVG(span), 3) AS processing_time
     FROM (
       SELECT machine_id, process_id,
              MAX(CASE WHEN activity_type = 'end' THEN timestamp END)
            - MAX(CASE WHEN activity_type = 'start' THEN timestamp END) AS span
       FROM Activity
       GROUP BY machine_id, process_id
     )
     GROUP BY machine_id`,

  "employee-bonus":
    `SELECT e.name, b.bonus
     FROM Employee e LEFT JOIN Bonus b ON b.empId = e.empId
     WHERE b.bonus IS NULL OR b.bonus < 1000`,

  // Every student takes every subject, so the row set is a CROSS JOIN; the examinations table
  // only supplies the count, and COUNT(e.subject_name) — not COUNT(*) — is what makes an
  // unattended exam read 0 rather than 1.
  "students-and-examinations":
    `SELECT s.student_id, s.student_name, sub.subject_name, COUNT(e.subject_name) AS attended_exams
     FROM Students s
     CROSS JOIN Subjects sub
     LEFT JOIN Examinations e ON e.student_id = s.student_id AND e.subject_name = sub.subject_name
     GROUP BY s.student_id, sub.subject_name
     ORDER BY s.student_id, sub.subject_name`,

  "managers-with-at-least-5-direct-reports":
    `SELECT m.name
     FROM Employee m JOIN Employee e ON e.managerId = m.id
     GROUP BY m.id
     HAVING COUNT(*) >= 5`,

  "confirmation-rate":
    `SELECT s.user_id,
            ROUND(IFNULL(AVG(CASE WHEN c.action = 'confirmed' THEN 1.0 ELSE 0 END), 0), 2) AS confirmation_rate
     FROM Signups s LEFT JOIN Confirmations c ON c.user_id = s.user_id
     GROUP BY s.user_id`,

  "not-boring-movies":
    `SELECT id, movie, description, rating
     FROM cinema
     WHERE id % 2 = 1 AND description <> 'boring'
     ORDER BY rating DESC`,

  // The join carries the date window, so a unit sold outside every price period contributes to
  // neither the numerator nor the denominator. IFNULL covers the product with no sales at all,
  // where SUM is NULL rather than 0.
  "average-selling-price":
    `SELECT p.product_id,
            ROUND(IFNULL(SUM(u.units * p.price) * 1.0 / SUM(u.units), 0), 2) AS average_price
     FROM Prices p
     LEFT JOIN UnitsSold u
       ON u.product_id = p.product_id
      AND u.purchase_date BETWEEN p.start_date AND p.end_date
     GROUP BY p.product_id`,

  "project-employees-i":
    "SELECT p.project_id, ROUND(AVG(e.experience_years), 2) AS average_years FROM Project p JOIN Employee e ON e.employee_id = p.employee_id GROUP BY p.project_id",

  "percentage-of-users-attended-a-contest":
    `SELECT contest_id,
            ROUND(COUNT(DISTINCT user_id) * 100.0 / (SELECT COUNT(*) FROM Users), 2) AS percentage
     FROM Register
     GROUP BY contest_id`,

  "queries-quality-and-percentage":
    `SELECT query_name,
            ROUND(AVG(rating * 1.0 / position), 2) AS quality,
            ROUND(AVG(CASE WHEN rating < 3 THEN 1.0 ELSE 0 END) * 100, 2) AS poor_query_percentage
     FROM Queries
     GROUP BY query_name`,

  "monthly-transactions-i":
    `SELECT strftime('%Y-%m', trans_date) AS month, country,
            COUNT(*) AS trans_count,
            SUM(CASE WHEN state = 'approved' THEN 1 ELSE 0 END) AS approved_count,
            SUM(amount) AS trans_total_amount,
            SUM(CASE WHEN state = 'approved' THEN amount ELSE 0 END) AS approved_total_amount
     FROM Transactions
     GROUP BY month, country`,

  // The first order per customer is the MIN(order_date); the row-value IN keeps the customer
  // and the date paired, which a plain `order_date IN (SELECT MIN(...))` would not.
  "immediate-food-delivery-ii":
    `SELECT ROUND(AVG(CASE WHEN order_date = customer_pref_delivery_date THEN 1.0 ELSE 0 END) * 100, 2) AS immediate_percentage
     FROM Delivery
     WHERE (customer_id, order_date) IN (
       SELECT customer_id, MIN(order_date) FROM Delivery GROUP BY customer_id
     )`,

  "game-play-analysis-iv":
    `SELECT ROUND(
              COUNT(DISTINCT a.player_id) * 1.0
              / (SELECT COUNT(DISTINCT player_id) FROM Activity),
            2) AS fraction
     FROM Activity a
     WHERE a.event_date = date(
       (SELECT MIN(x.event_date) FROM Activity x WHERE x.player_id = a.player_id), '+1 day'
     )`,

  "number-of-unique-subjects-taught-by-each-teacher":
    "SELECT teacher_id, COUNT(DISTINCT subject_id) AS cnt FROM Teacher GROUP BY teacher_id",

  "user-activity-for-the-past-30-days-i":
    `SELECT activity_date AS day, COUNT(DISTINCT user_id) AS active_users
     FROM Activity
     WHERE activity_date BETWEEN date('2019-07-27', '-29 days') AND '2019-07-27'
     GROUP BY activity_date`,

  "product-sales-analysis-iii":
    `SELECT s.product_id, s.year AS first_year, s.quantity, s.price
     FROM Sales s
     WHERE (s.product_id, s.year) IN (
       SELECT product_id, MIN(year) FROM Sales GROUP BY product_id
     )`,

  "classes-with-at-least-5-students":
    "SELECT class FROM Courses GROUP BY class HAVING COUNT(*) >= 5",

  "find-followers-count":
    "SELECT user_id, COUNT(*) AS followers_count FROM Followers GROUP BY user_id ORDER BY user_id",

  // MAX over the empty set is NULL, which is exactly the required answer when no number is
  // single, so no CASE is needed.
  "biggest-single-number":
    `SELECT MAX(num) AS num
     FROM (SELECT num FROM MyNumbers GROUP BY num HAVING COUNT(*) = 1)`,

  "customers-who-bought-all-products":
    `SELECT customer_id
     FROM Customer
     GROUP BY customer_id
     HAVING COUNT(DISTINCT product_key) = (SELECT COUNT(*) FROM Product)`,

  "the-number-of-employees-which-report-to-each-employee":
    `SELECT m.employee_id, m.name, COUNT(*) AS reports_count, ROUND(AVG(e.age)) AS average_age
     FROM Employees m JOIN Employees e ON e.reports_to = m.employee_id
     GROUP BY m.employee_id
     ORDER BY m.employee_id`,

  "primary-department-for-each-employee":
    `SELECT employee_id, department_id
     FROM Employee
     WHERE primary_flag = 'Y'
        OR employee_id IN (
             SELECT employee_id FROM Employee GROUP BY employee_id HAVING COUNT(*) = 1
           )`,

  "triangle-judgement":
    `SELECT x, y, z,
            CASE WHEN x + y > z AND x + z > y AND y + z > x THEN 'Yes' ELSE 'No' END AS triangle
     FROM Triangle`,

  // Self-joins on the id sequence rather than on LAG(): the statement guarantees consecutive
  // ids, and this form runs on every SQLite build.
  "consecutive-numbers":
    `SELECT DISTINCT l1.num AS ConsecutiveNums
     FROM Logs l1
     JOIN Logs l2 ON l2.id = l1.id + 1
     JOIN Logs l3 ON l3.id = l1.id + 2
     WHERE l1.num = l2.num AND l2.num = l3.num`,

  // Two branches: products with no price change on or before the date fall back to the initial
  // 10, and everything else takes its latest change at or before the date.
  "product-price-at-a-given-date":
    `SELECT product_id, 10 AS price
     FROM Products
     GROUP BY product_id
     HAVING MIN(change_date) > '2019-08-16'
     UNION
     SELECT p.product_id, p.new_price AS price
     FROM Products p
     WHERE p.change_date <= '2019-08-16'
       AND p.change_date = (
             SELECT MAX(x.change_date) FROM Products x
             WHERE x.product_id = p.product_id AND x.change_date <= '2019-08-16'
           )`,

  // The running total is the join against every earlier turn; the last turn whose cumulative
  // weight still fits is the answer.
  "last-person-to-fit-in-the-bus":
    `SELECT q1.person_name
     FROM Queue q1 JOIN Queue q2 ON q1.turn >= q2.turn
     GROUP BY q1.turn
     HAVING SUM(q2.weight) <= 1000
     ORDER BY q1.turn DESC
     LIMIT 1`,

  // Three separate counts, not a GROUP BY over a CASE: a category with no accounts must still
  // appear with 0, and a GROUP BY simply omits it.
  "count-salary-categories":
    `SELECT 'Low Salary' AS category, COUNT(*) AS accounts_count FROM Accounts WHERE income < 20000
     UNION ALL
     SELECT 'Average Salary', COUNT(*) FROM Accounts WHERE income BETWEEN 20000 AND 50000
     UNION ALL
     SELECT 'High Salary', COUNT(*) FROM Accounts WHERE income > 50000`,

  "employees-whose-manager-left-the-company":
    `SELECT employee_id
     FROM Employees
     WHERE salary < 30000
       AND manager_id IS NOT NULL
       AND manager_id NOT IN (SELECT employee_id FROM Employees)
     ORDER BY employee_id`,

  // The last id stays put when it is odd and unpaired; every other id swaps with its neighbour.
  "exchange-seats":
    `SELECT CASE
              WHEN id % 2 = 1 AND id = (SELECT MAX(id) FROM Seat) THEN id
              WHEN id % 2 = 1 THEN id + 1
              ELSE id - 1
            END AS id,
            student
     FROM Seat
     ORDER BY id`,

  // Two questions, two answers stacked as rows. Each is a scalar subquery rather than a plain
  // SELECT: SQLite rejects `ORDER BY … UNION ALL`, so the ordering has to live inside each
  // branch. The tiebreak in both is the lexicographically smaller name, as specified.
  "movie-rating":
    `SELECT (
       SELECT u.name
       FROM Users u JOIN MovieRating m ON m.user_id = u.user_id
       GROUP BY u.user_id
       ORDER BY COUNT(*) DESC, u.name ASC
       LIMIT 1
     ) AS results
     UNION ALL
     SELECT (
       SELECT mo.title
       FROM Movies mo JOIN MovieRating mr ON mr.movie_id = mo.movie_id
       WHERE strftime('%Y-%m', mr.created_at) = '2020-02'
       GROUP BY mo.movie_id
       ORDER BY AVG(mr.rating) DESC, mo.title ASC
       LIMIT 1
     ) AS results`,

  // The seven-day window is a self-join over distinct visit dates; a date whose window does not
  // yet contain seven distinct days is dropped, which is why the output starts on the 7th.
  "restaurant-growth":
    `SELECT c1.visited_on,
            SUM(c2.amount) AS amount,
            ROUND(SUM(c2.amount) / 7.0, 2) AS average_amount
     FROM (SELECT DISTINCT visited_on FROM Customer) c1
     JOIN Customer c2
       ON c2.visited_on BETWEEN date(c1.visited_on, '-6 days') AND c1.visited_on
     GROUP BY c1.visited_on
     HAVING COUNT(DISTINCT c2.visited_on) = 7
     ORDER BY c1.visited_on`,

  // Friendship is symmetric: a person's friend count is their appearances in either column,
  // which is why the two are UNION ALL-ed before grouping.
  "friend-requests-ii-who-has-the-most-friends":
    `SELECT id, COUNT(*) AS num
     FROM (
       SELECT requester_id AS id FROM RequestAccepted
       UNION ALL
       SELECT accepter_id FROM RequestAccepted
     )
     GROUP BY id
     ORDER BY num DESC
     LIMIT 1`,

  "investments-in-2016":
    `SELECT ROUND(SUM(tiv_2016), 2) AS tiv_2016
     FROM Insurance
     WHERE tiv_2015 IN (
             SELECT tiv_2015 FROM Insurance GROUP BY tiv_2015 HAVING COUNT(*) > 1
           )
       AND (lat, lon) IN (
             SELECT lat, lon FROM Insurance GROUP BY lat, lon HAVING COUNT(*) = 1
           )`,

  // "Top three unique salaries" is a rank with gaps collapsed, which is what counting the
  // strictly-greater DISTINCT salaries expresses. ROW_NUMBER would return the wrong four
  // rows for a department where two people share the third salary.
  "department-top-three-salaries":
    `SELECT d.name AS Department, e.name AS Employee, e.salary AS Salary
     FROM Employee e JOIN Department d ON d.id = e.departmentId
     WHERE (
       SELECT COUNT(DISTINCT e2.salary)
       FROM Employee e2
       WHERE e2.departmentId = e.departmentId AND e2.salary > e.salary
     ) < 3`,

  "fix-names-in-a-table":
    `SELECT user_id,
            UPPER(SUBSTR(name, 1, 1)) || LOWER(SUBSTR(name, 2)) AS name
     FROM Users
     ORDER BY user_id`,

  // Two LIKE patterns rather than `%DIAB1%`: the code must start a condition, so a value like
  // 'XDIAB100' must not match, and `% DIAB1%` covers every condition after the first.
  "patients-with-a-condition":
    `SELECT patient_id, patient_name, conditions
     FROM Patients
     WHERE conditions LIKE 'DIAB1%' OR conditions LIKE '% DIAB1%'`,

  // The one problem in the 50 whose answer is a mutation, not a result set. The driver shows
  // the Person table afterwards, and `run.ts` compares exactly that for a mutating submission.
  "delete-duplicate-emails":
    "DELETE FROM Person WHERE id NOT IN (SELECT MIN(id) FROM Person GROUP BY email)",

  "second-highest-salary":
    "SELECT (SELECT DISTINCT salary FROM Employee ORDER BY salary DESC LIMIT 1 OFFSET 1) AS SecondHighestSalary",

  // GROUP_CONCAT(DISTINCT product ORDER BY product) is a syntax error in SQLite, so the
  // ordered, de-duplicated list comes from a subquery over SELECT DISTINCT … ORDER BY.
  //
  // This is the one problem where the statement's own rendered Output table disagrees with its
  // seed data: the table shows `T-shirt`, the seed row is `T-Shirt`, and SQLite's GROUP_CONCAT
  // is case-sensitive. The seed is what the driver actually runs against, so this query matches
  // the seed. A student who writes the same logic gets the same string, and grading compares
  // against this query rather than against the ASCII table.
  "group-sold-products-by-the-date":
    `SELECT a.sell_date,
            COUNT(DISTINCT a.product) AS num_sold,
            (
              SELECT GROUP_CONCAT(p, ',')
              FROM (
                SELECT DISTINCT product AS p FROM Activities a2
                WHERE a2.sell_date = a.sell_date ORDER BY product
              )
            ) AS products
     FROM Activities a
     GROUP BY a.sell_date
     ORDER BY a.sell_date`,

  "list-the-products-ordered-in-a-period":
    `SELECT p.product_name, SUM(o.unit) AS unit
     FROM Products p JOIN Orders o ON o.product_id = p.product_id
     WHERE strftime('%Y-%m', o.order_date) = '2020-02'
     GROUP BY p.product_id
     HAVING SUM(o.unit) >= 100`,

  // `NOT GLOB '*[^…]*'` is the character-set test: GLOB is a full match, so the negated class
  // matches only when the prefix contains a character outside the allowed set. A leading-letter
  // check and a case-sensitive domain match complete it.
  "find-users-with-valid-e-mails":
    `SELECT user_id, name, mail
     FROM Users
     WHERE mail GLOB '*@leetcode.com'
       AND SUBSTR(mail, 1, 1) GLOB '[a-zA-Z]'
       AND SUBSTR(mail, 1, LENGTH(mail) - 13) NOT GLOB '*[^a-zA-Z0-9_.-]*'`,
};
