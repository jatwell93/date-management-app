# Quickstart Guide

This guide provides a quick way to test the core functionality of the application, based on the user stories in the feature specification.

## Prerequisites

- The application is running (frontend and backend).
- You are logged in as a "Team Member".

## Scenario 1: Scan a product and add an expiry date

1.  **Navigate** to the main scanning screen.
2.  **Scan** a product barcode using your device's camera.
3.  **Verify** that the product's name, SKU, and cost price are displayed.
4.  **Enter** an expiry date in the `dd/mm/yyyy` format.
5.  **Click** the "Confirm & Save" button.
6.  **Verify** that the screen resets, ready for the next scan.
7.  **Check** the database to confirm that a new `inventory_items` record was created with the correct details.

## Scenario 2: Generate a monthly markdown report (as a Manager)

1.  **Log out** and **log in** as a "Manager".
2.  **Navigate** to the "Reports" section.
3.  **Click** the "Generate Monthly Markdown Report" button.
4.  **Verify** that a PDF report is downloaded.
5.  **Open** the PDF and verify that it contains the correct data for items that are due for markdown.

## Scenario 3: View the analytics dashboard (as a Manager)

1.  **Log in** as a "Manager".
2.  **Navigate** to the "Dashboard" section.
3.  **Verify** that the dashboard displays the following:
    *   A bar graph showing the total value of stock scheduled for markdown next month.
    *   A table of the top 5 most frequently marked-down items.
    *   A table of store areas that have not been checked in the last 30 days.
