variable "tenancy_ocid" {
  type = string
}

variable "user_ocid" {
  type = string
}

variable "fingerprint" {
  type = string
}

variable "private_key_path" {
  type        = string
  description = "Path to the OCI API signing private key on this machine"
}

variable "region" {
  type        = string
  description = "Home region of your tenancy, e.g. uk-london-1"
}

variable "compartment_ocid" {
  type        = string
  description = "Compartment for all resources (the tenancy OCID works for the root compartment)"
}

variable "ssh_public_key" {
  type        = string
  description = "Public key that can log in to the VM as ubuntu"
}

variable "ad_index" {
  type        = number
  default     = 0
  description = "Availability domain index (0, 1 or 2). Change it if you get 'out of capacity'."
}

variable "ocpus" {
  type        = number
  default     = 4
  description = "Always Free A1 allows up to 4 OCPU in total"
}

variable "memory_gb" {
  type        = number
  default     = 24
  description = "Always Free A1 allows up to 24 GB in total"
}

variable "boot_volume_gb" {
  type        = number
  default     = 100
  description = "Always Free allows up to 200 GB of block storage in total"
}

variable "repo_url" {
  type        = string
  default     = "https://github.com/mzst-26/SafeNight.git"
  description = "Repository to clone onto the VM. Must be readable without credentials (or use a deploy token URL)."
}

variable "env_file_path" {
  type        = string
  default     = "../../backend/.env"
  description = "Local path to the backend .env file (secrets). Copied to the VM at first boot, never stored in git."
}

variable "ssh_allowed_cidr" {
  type        = string
  description = "Source address allowed to SSH (port 22). Use your own IP as x.x.x.x/32."
}

variable "repo_ref" {
  type        = string
  default     = "main"
  description = "Git tag or full commit SHA to deploy. Set a tag or SHA in terraform.tfvars to pin the deploy; the default tracks the main branch."
}
