project_id                = "hpb-eos-prod"
region                    = "us-east1"
google_oauth_client_id    = "580850228782-7eueud7s70j18pguiiaktum8qeesudgk.apps.googleusercontent.com"
google_oauth_redirect_uri = "https://pulse.highplainsbank.com/api/google/tasks/callback"

# Phase 1 front door (load_balancer.tf): pulse.highplainsbank.com via external HTTPS LB.
enable_load_balancer = true
