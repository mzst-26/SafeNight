# One Oracle Always Free VM that runs the whole SafeNight backend with docker compose.
# Creates: network, public subnet, firewall rules (22/80/443), an Ampere A1 Ubuntu VM,
# and a cloud-init script that installs Docker, clones the repo, writes backend/.env,
# opens the host firewall and starts the stack. Nothing is set up by hand.

terraform {
  required_version = ">= 1.5"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
  }
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_ocid
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "safenight" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "safenight-vcn"
  dns_label      = "safenight"
}

resource "oci_core_internet_gateway" "safenight" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.safenight.id
  display_name   = "safenight-igw"
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.safenight.id
  display_name   = "safenight-public-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.safenight.id
  }
}

resource "oci_core_security_list" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.safenight.id
  display_name   = "safenight-public-sl"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  dynamic "ingress_security_rules" {
    for_each = [22, 80, 443]
    content {
      protocol = "6" # TCP
      source   = ingress_security_rules.value == 22 ? var.ssh_allowed_cidr : "0.0.0.0/0"
      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.safenight.id
  cidr_block        = "10.0.1.0/24"
  display_name      = "safenight-public-subnet"
  dns_label         = "public"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.public.id]
}

resource "oci_core_instance" "safenight" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.ad_index].name
  display_name        = "safenight"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_gb
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gb
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    display_name     = "safenight-vnic"
  }

  # Legacy (v1) metadata endpoints off: only authenticated v2 calls can read instance metadata.
  # Applied in place with the OCI CLI, not Terraform: changing these forces the instance to be replaced.
  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }

  # Managed in place (see notes above). Terraform must not replace the VM over metadata changes.
  lifecycle {
    ignore_changes = [metadata, instance_options]
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      repo_url = var.repo_url
      repo_ref = var.repo_ref
    }))
  }
}

output "public_ip" {
  value       = oci_core_instance.safenight.public_ip
  description = "Point your domain's A record at this address, then open https://<domain>/geocode/api/health"
}

output "ssh" {
  value = "ssh ubuntu@${oci_core_instance.safenight.public_ip}"
}
