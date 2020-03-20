#!/usr/bin/env node

const yargs = require('yargs')
const AWS = require('aws-sdk')
const bunyan = require('bunyan')
const Promise = require('bluebird')
const _ = require('lodash')

let log

const efs = new AWS.EFS({ apiVersion: '2015-02-01', region: process.env.AWS_REGION })
const ec2 = new AWS.EC2({ apiVersion: '2016-11-15' })
const elb = new AWS.ELBv2({ apiVersion: '2015-12-01' });
const elbClassic = new AWS.ELB();

const yargsFunc = (yargs) => {
  yargs.positional('vpc-id', { describe: 'ID of the VPC', default: null })
}

yargs
  .command('delete [vpc-id]', 'Delete the VPC and all dependencies', yargsFunc, async (argv) => {
    const stream = argv.logToStdout ? process.stdout : process.stderr
    log = bunyan.createLogger({ name: "delete-vpc", level: argv.logLevel, stream  })
    argv.dryRun = false;
    await deleteEC2Instances(argv.vpcId, argv.dryRun) // Remove Instances
    await deleteELBs(argv.vpcId, argv.dryRun) // Remove Load Balancers
    await deleteELBsClassic(argv.vpcId, argv.dryRun) // Remove Load Balancers
    await deleteEFS(argv.vpcId, argv.dryRun) // Remove EFS volumes
    await deleteNATGateways(argv.vpcId, argv.dryRun) // Remove NAT Gateways
    await deleteNetworkInterfaces(argv.vpcId, argv.dryRun) // Remove Network Interfaces   
    await deleteSecurityGroups(argv.vpcId, argv.dryRun) // Remove Instances
    await deleteInternetGateways(argv.vpcId, argv.dryRun) // Remove Internet Gateways
    await deleteSubnets(argv.vpcId, argv.dryRun)
    await deleteRouteTables(argv.vpcId, argv.dryRun)
    await deleteVPCEndpoints(argv.vpcId, argv.dryRun)
    await deleteVPC(argv.vpcId, argv.dryRun) // Remove VPC
    //await releaseEIPs(argv.vpcId, argv.dryRun) // Remove Instances
    console.log('VPC Deleted');
  })
  .option('log-level', { describe: 'Log level (debug, trace, info, warn, error)', default: 'info' })
  .option('log-to-stdout', { describe: 'Output logs to STDOUT instead of STDERR', default: true })
  .argv

async function releaseEIPs(VpcId, DryRun) {
  console.log('Releasing EIPs instances .... ')
  const params = {
    Filters: [
      {
        Name: 'domain',
        Values: [ 'vpc' ]
      }]
  };
  const response = await Promise.fromCallback(cb => ec2.describeAddresses(params, cb))
  await Promise.map(response.Addresses, async (item) => {
        const allocationID = item.AllocationId
        const releaseParams = { DryRun, AllocationId:allocationID }
        return $(ec2, 'releaseAddress', releaseParams, { allowedErrorCodes: ['OperationNotPermitted','InvalidAttachmentID.NotFound'], retryErrorCodes: ['AuthFailure','UnsupportedOperation','InvalidParameterValue','OperationalError'] })    
  })
}
  

async function deleteEC2Instances(vpcId, DryRun) {
  console.log('Deleting EC2 instances .... ')
  this.log = log.child({ methods: 'deleteEC2Instances', vpcId });
  this.log.trace('Start deleting EC2 instances')
  const filterParams = {
    Filters: [
    {
      Name: 'vpc-id',
      Values: [ vpcId ]
    }]
  }
  this.log.trace('Filter Params', { filterParams })
  const reservations = await Promise.fromCallback(cb => ec2.describeInstances(filterParams, cb))
  const instancesMap = reservations.Reservations.reduce((accumulator, current) => {
    current.Instances.forEach(i => { accumulator[i.InstanceId] = i })
    return accumulator
  }, {})
  const Ids = Object.keys(instancesMap)
  this.log.trace('Instances', { Ids })
  if (Ids.length === 0) {
    this.log.trace('No instances to delete')
    return []
  }
  const deleteParams = { InstanceIds:Ids, DryRun }
  this.log.trace('DeleteParams', { deleteParams })
  return $(ec2, 'terminateInstances', deleteParams)
}

async function deleteELBs(vpcId, DryRun) {
  console.log('Deleting ELBs non-classic instances .... ')
  this.log = log.child({ methods: 'deleteELBs', vpcId });
  this.log.trace('Start')
  const elbs = await Promise.fromCallback(cb => elb.describeLoadBalancers({}, cb))
  const elbsInVPC = elbs.LoadBalancers.filter(x => x.VpcId === vpcId)  
  
  return await Promise.map(elbsInVPC, async (elbInstance) => {
    const deleteParams = {
      LoadBalancerArn: elbInstance.LoadBalancerArn
    }
    
    if (DryRun) {
      this.log.info('Dry run. Deleteing ELB', { name: elbInstance.LoadBalancerName })
      return
    }
    return await $(elb, 'deleteLoadBalancer', deleteParams)
  })
}

async function deleteELBsClassic(vpcId, DryRun) {
  console.log('Deleting ELBs classic instances .... ')
  this.log = log.child({ methods: 'deleteELBs', vpcId });
  this.log.trace('Start')
  const elbs = await Promise.fromCallback(cb => elbClassic.describeLoadBalancers({}, cb))
  const elbsInVPC = elbs.LoadBalancerDescriptions.filter(x => x.VPCId === vpcId)  
  
  
  return await Promise.map(elbsInVPC, async (elbInstance) => {
    const deleteParams = {
      LoadBalancerName: elbInstance.LoadBalancerName
    }
    
    if (DryRun) {
      this.log.info('Dry run. Deleteing ELB', { name: elbInstance.LoadBalancerName })
      return
    }
    return await $(elbClassic, 'deleteLoadBalancer', deleteParams)
  })
}


async function deleteVPCEndpoints(VpcId, DryRun) {
  console.log('Deleting VPC endpoint instances .... ')
  this.log = log.child({ methods: 'deleteVpcEndpoints', VpcId, DryRun });
  const params = {
    Filters: [
      {
        Name: 'vpc-id',
        Values: [ VpcId ]
      }]
  };
  const response = await Promise.fromCallback(cb => ec2.describeVpcEndpoints(params, cb))
  
  const endPointIds = response.VpcEndpoints.map(x => x.VpcEndpointId)
  
   await Promise.map(endPointIds, async (id) => {
    const params = { VpcEndpointIds:[id], DryRun };
    //const detachParams = Object.assign({}, params, { VpcId })
    //await $(ec2, 'deleteVpcEndpoints', detachParams)
    await $(ec2, 'deleteVpcEndpoints', params)
  })
  this.log.trace(`endPointIds succesfuly deleted DryRun: ${DryRun}`)
  return endPointIds
}

async function deleteInternetGateways(VpcId, DryRun) {
  console.log('Deleting IG instances .... ')
  this.log = log.child({ methods: 'deleteInternetGateways', VpcId, DryRun });
  this.log.trace('Start deleting internet gateways')
  const params = {
    Filters: [
      {
        Name: "attachment.vpc-id",
        Values: [ VpcId ]
      }
    ]
  };
  const response = await Promise.fromCallback(cb => ec2.describeInternetGateways(params, cb))
  const InternetGatewayIds = response.InternetGateways.map(x => x.InternetGatewayId)
  this.log.trace('Internet Gateway Ids', { InternetGatewayIds })

  await Promise.map(InternetGatewayIds, async (id) => {
    const params = { InternetGatewayId:id, DryRun };
    const detachParams = Object.assign({}, params, { VpcId })
    await $(ec2, 'detachInternetGateway', detachParams)
    await $(ec2, 'deleteInternetGateway', params)
  })
  this.log.trace(`InternetGateways succesfuly deleted DryRun: ${DryRun}`)
  return InternetGatewayIds
}

async function deleteEFS (vpcId, DryRun) {
  console.log('Deleting EFS instances .... ')
  this.log = log.child({ methods: 'deleteEFS', vpcId, DryRun });
  this.log.trace('Start deleting EFS Filesystems')
  const response = await Promise.fromCallback(cb => efs.describeFileSystems({}, cb))
  const fileSystemIds = response.FileSystems.map(x => x.FileSystemId)
  this.log.trace('fileSystemIds', { fileSystemIds })
  const mountTargets = await Promise.reduce(fileSystemIds, async (memo, FileSystemId) => {
    const params = { FileSystemId }
    const response = await Promise.fromCallback(cb => efs.describeMountTargets(params, cb))
    this.log.trace('memoLength', { length: memo.length, super: response.MountTargets.length })
    return [].concat(memo).concat(response.MountTargets)
  }, [])
  const subnetIds = await getSubnetIds(vpcId)
  this.log.trace('mountTargets', { mountTargets })
  this.log.trace('subnetIds', { subnetIds })
  const mountTargetsToBeDeleted = mountTargets.filter(x => {
    this.log.trace('SubnetId', { SubnetId: x.SubnetId })
    return subnetIds.includes(x.SubnetId)
  })
  this.log.trace('mountTargetsToBeDeleted', { mountTargetsToBeDeleted })
  const fileSystemsToBeDeleted = _.uniq(mountTargetsToBeDeleted.map(x => x.FileSystemId))
  this.log.trace('fileSystemsToBeDeleted', { fileSystemsToBeDeleted })
  await Promise.map(mountTargetsToBeDeleted, async (mountTarget) => {
    const params = { MountTargetId: mountTarget.MountTargetId }
    this.log.trace('Delete File System', { params })
    return await $(efs, 'deleteMountTarget', params)
  })
  // NOTE: This will delete any EFS with a mount target in the subet. Very greedy
  // Ideally it would only delete EFS with all mount targets in a VPC
  await Promise.delay(3000)
  await Promise.map(fileSystemsToBeDeleted, async (FileSystemId) => {
    const params = { FileSystemId }
    this.log.trace('Delete File System', { FileSystemId })
    return await $(efs, 'deleteFileSystem', params, { retryErrorCodes: 'FileSystemInUse', retries: 10 })
  })
}

async function deleteNATGateways(vpcId, DryRun) {
  console.log('Deleting NAT Gateways instances .... ')
  this.log = log.child({ methods: 'deleteNATGateways', vpcId, DryRun });
  this.log.trace('Start deleting NAT Gateways')
  const params = {
    Filter: [
      {
        Name: "vpc-id",
        Values: [ vpcId ]
      }
    ]
  };
  const response = await Promise.fromCallback(cb => ec2.describeNatGateways(params, cb))
  const NatGatewayIds = response.NatGateways.map(x => x.NatGatewayId)

  return await Promise.map(NatGatewayIds, async (id) => {
    const params = { NatGatewayId:id };
    await $(ec2, 'deleteNatGateway', params)
  })
}

async function getSubnetIds (vpcId) {
  const params = {
    Filters: [{
      Name: "vpc-id",
      Values: [ vpcId ]
    }]
  };
  const subnetResponse = await Promise.fromCallback(cb => ec2.describeSubnets(params, cb))
  return subnetResponse.Subnets.map(x => x.SubnetId)
}

async function deleteSubnets (id, DryRun) {
  console.log('Deleting subnets instances .... ')
  this.log = log.child({ methods: 'deleteSubnets', id, DryRun });
  this.log.trace('Start deleting subnets')
  const params = { VpcId: id, DryRun };
  const subnetIds = await getSubnetIds(id)
  this.log.trace('SubnetIds', { subnetIds })
  await Promise.delay(3000)
  await Promise.map(subnetIds, async (SubId) => {
    const params = {SubnetId:SubId, DryRun}
    this.log.trace('Deleting subnet', { SubId })
    await $(ec2, 'deleteSubnet', params, { retryErrorCodes: 'DependencyViolation' })
  })
}

async function deleteVPC (id, DryRun) {
  console.log('Finallay, deleting VPC instances .... ')
  this.log = log.child({ methods: 'deleteVPC', VpcId: id || 'nothing', DryRun });
  this.log.trace('Start deleting VPC')
  const params = { VpcId: id, DryRun };
  await $(ec2, 'deleteVpc', params, { allowedErrorCodes: 'InvalidVpcID.NotFound' })
  this.log.info('VPC Deleted')
}

async function deleteSecurityGroups (vpcId, DryRun) {
  var params = {
    DryRun,
    Filters: [{
      Name: 'vpc-id',
      Values: [ vpcId ]
    }]
  }
  const securityGroups = (await Promise.fromCallback(cb => ec2.describeSecurityGroups(params, cb))).SecurityGroups;
  this.log.trace('Security Groups', { securityGroups })
  await Promise.mapSeries(securityGroups, async (securityGroup) => {
    this.log.trace('Security group', { securityGroup,   })
    await Promise.mapSeries(securityGroup.IpPermissions, async (ruleUnfiltered) => {
      const rule = {}
      rule.GroupId = securityGroup.GroupId
      if (!_.isEmpty(ruleUnfiltered.IpRanges)) {
        const ipRange = ruleUnfiltered.IpRanges[0]
        rule.IpProtocol = ruleUnfiltered.IpProtocol
        rule.FromPort = ruleUnfiltered.FromPort
        rule.ToPort = ruleUnfiltered.ToPort
        rule.CidrIp = ipRange.CidrIp
      }
      if (!_.isEmpty(ruleUnfiltered.UserIdGroupPairs)) {
        rule.IpPermissions = [ _.pick(ruleUnfiltered, ['IpProtocol', 'UserIdGroupPairs', 'FromPort', 'ToPort']) ]
      }
      this.log.trace('Delete Ingress Rule', { rule, ruleUnfiltered })
      await $(ec2, 'revokeSecurityGroupIngress', rule)
    })
    return
  })
  const sgIds = securityGroups.filter(x => x.GroupName !== 'default').map(x => x.GroupId)

  this.log.trace('Security Group Ids', { sgIds })
  await Promise.delay(1000)
  await Promise.map(sgIds, async function (id) {
    const params = { GroupId:id, DryRun }
    return await $(ec2, 'deleteSecurityGroup', params)
  })
}

async function deleteNetworkInterfaces (VpcId, DryRun) {
  this.log = log.child({ methods: 'deleteNetworkInterfaces', VpcId });
  const queryParams = {
    DryRun,
    Filters: [
      {
        Name: 'vpc-id',
        Values: [ VpcId ]
      }
    ]
  };
  const response = await Promise.fromCallback(cb => ec2.describeNetworkInterfaces(queryParams, cb))
  const networkInterfaceIds = response.NetworkInterfaces.map(x => x.NetworkInterfaceId)
  const networkInterfaceAttachmentIds = response.NetworkInterfaces.map(x => _.get(x, 'Attachment.AttachmentId')).filter(x => !!x)
  await Promise.map(networkInterfaceAttachmentIds, async (id) => {
    const detachParams = { AttachmentId:id, Force: true, DryRun }
    await $(ec2, 'detachNetworkInterface', detachParams, { allowedErrorCodes: ['OperationNotPermitted','InvalidAttachmentID.NotFound'], retryErrorCodes: ['AuthFailure','UnsupportedOperation','InvalidParameterValue','OperationalError'] })
  })
  await Promise.map(networkInterfaceIds, async (id) => {
    const deleteParams = { DryRun, NetworkInterfaceId:id }
    return $(ec2, 'deleteNetworkInterface', deleteParams, { allowedErrorCodes: 'InvalidNetworkInterfaceID.NotFound', retryErrorCodes: ['AuthFailure','UnsupportedOperation','InvalidParameterValue','OperationalError'] })
  })
}

async function deleteRouteTables (VpcId, DryRun) {
  const queryParams = {
    DryRun,
    Filters: [
      {
        Name: 'vpc-id',
        Values: [ VpcId ]
      },
    ]
  }
  const response = await Promise.fromCallback(cb => ec2.describeRouteTables(queryParams, cb))
  // TODO: This should filter out the default route table
  //const routeTableIds = response.RouteTables.filter(x => ((typeof x.Associations[0] !== 'undefined') && !x.Associations[0].Main)).map(x => x.RouteTableId)
  const routeTableIds = response.RouteTables.map(x => x.RouteTableId)
  return await Promise.map(routeTableIds, async (id) => {
    const query = { RouteTableId: id, DryRun }    
    return  $(ec2, 'deleteRouteTable', query,{ allowedErrorCodes: 'DependencyViolation' } )
   })
}

async function $(classInstance, methodName, query, opts = {}) {
  this.log = log.child({ methods: '$', endpoint: classInstance.endpoint.host, methodName, query, opts });
  const className = classInstance.endpoint.host.split('.')[0]
  let result
  try {
    result = await Promise.fromCallback(cb => classInstance[methodName](query, cb))
  } catch (err) {
    if (opts.retryErrorCodes && opts.retryErrorCodes.includes(err.code)) {
      opts.retries = ((_.isNumber(opts.retries) ? opts.retries : 20) - 1)
      if (opts.retries <= 0) {
        this.log.error('No retries left', { retries: opts.retries, errorCode: err.code })
        return
        //throw err
      }
      this.log.trace('Retrying', { retries: opts.retries, errorCode: err.code })
      await Promise.delay(opts.retryDelay || 5000)
      return $(classInstance, methodName, query, opts)
    }
    if (opts.allowedErrorCodes && opts.allowedErrorCodes.includes(err.code)) {
      this.log.trace('Allowed Error', { errorCode: err.code })
      return 
    }
    if (opts.unHandledErrorCodes && opts.unHandledErrorCodes.includes(err.code)) {
      this.log.error('Unhandled Error. This error is unhanlded and cannot be fixed by re-running this command. Log in to the AWS console and check what other resources are tied this resource.', { errorCode: err.code })
      throw err
    }
    this.log.error(`Error executing ${className}.${methodName}`, { errorCode: err.code })
    throw err
  }
  return result
}
